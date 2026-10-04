/**
 * One group per session (M13.8). Host mode runs the watchers on the selected group's token and nothing else;
 * switching groups stops the old watchers completely, then starts new ones on the other token, so one game
 * can never be posted to two groups (and a block queued for one group sits in that group's own state
 * directory, `groups.ts` `hostStateDir`). Overlay mode posts nothing: a selection only changes which group
 * the panel reads for.
 *
 * Serialised: every start, stop and switch runs after the one before it, so two quick picks cannot leave two
 * hosts running. The session never throws; a failed config write is a log line.
 */

import type { AppMode, CompanionConfig } from './config.js';
import {
  type GroupView,
  groupViews,
  LEGACY_GROUP_ID,
  type PickerView,
  pickerFor,
  selectGroup,
  setLastGroup,
  tokenNoLongerWorks,
} from './groups.js';
import type { HostHandle } from './host.js';
import { type CompanionLogger, errorFields } from './log.js';

/** What the panel shows about groups; pushed to it whole every time it changes. */
export interface GroupPanelState {
  /** Null with fewer than two groups. */
  readonly picker: PickerView | null;
  /** Overlay with zero memberships, once the server has answered: the panel shows the one sentence. */
  readonly noGroups: boolean;
  /** `This token no longer works for <Group>. ...`, until a group is picked. */
  readonly error: string | null;
  /** Host: a switch is in progress; the select is disabled. */
  readonly switching: boolean;
}

export type HostFactory = (group: GroupView, onTokenRefused: (status: 401 | 403) => void) => HostHandle;

export interface GroupSessionOptions {
  readonly mode: AppMode;
  readonly configDir: string;
  /** Re-reads the config file after a write. Null when it cannot be read. */
  readonly reload: () => CompanionConfig | null;
  readonly initial: CompanionConfig;
  /** Host mode only. */
  readonly startHost?: HostFactory;
  readonly logger: CompanionLogger;
  readonly onState: (state: GroupPanelState) => void;
  /** The selected group changed (either mode): the panel refetches for it. */
  readonly onSelected?: (group: GroupView | null) => void;
  /** How often a swap deferred for a game in progress looks again. Default 5 s. */
  readonly busyRecheckMs?: number;
}

export class GroupSession {
  private views: GroupView[];
  private lastGroupId: string | undefined;
  private selectedView: GroupView | null;
  private host: HostHandle | null = null;
  private hostGroupId: string | null = null;
  private hostToken: string | undefined;
  private recheck: ReturnType<typeof setTimeout> | null = null;
  /** The group and token the server last refused with 403; not relaunched until the token changes. */
  private refused: { groupId: string; token: string | undefined } | null = null;
  private error: string | null = null;
  private switching = false;
  private serverAnswered = false;
  private stopped = false;
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly options: GroupSessionOptions) {
    this.views = groupViews(options.initial);
    this.lastGroupId = options.initial.lastGroupId;
    this.selectedView = selectGroup(this.views, options.mode, this.lastGroupId);
  }

  selected(): GroupView | null {
    return this.selectedView;
  }

  /** Group ids the watchers are running for right now: never more than one. */
  runningGroupId(): string | null {
    return this.hostGroupId;
  }

  state(): GroupPanelState {
    return {
      picker: pickerFor(this.options.mode, this.views, this.selectedView),
      noGroups: this.options.mode === 'overlay' && this.views.length === 0 && this.serverAnswered,
      error: this.error,
      switching: this.switching,
    };
  }

  /** Starts the watchers on the selected group (Host) and publishes the first state. */
  start(): Promise<void> {
    return this.enqueue(async () => {
      if (this.options.mode === 'host' && this.selectedView !== null) {
        this.launch(this.selectedView);
      }
      this.emit();
    });
  }

  /** The person picked a group in the panel. Unknown ids and (Host) groups without a token are ignored. */
  select(groupId: string): Promise<void> {
    return this.enqueue(async () => {
      const next = this.views.find((view) => view.groupId === groupId);
      if (next === undefined) {
        this.options.logger.warn('group pick ignored: not a group on this PC');
        return;
      }
      if (this.options.mode === 'host') {
        if (next.token === undefined) {
          this.options.logger.warn('group pick ignored: no host token for it', { groupId });
          return;
        }
        if (this.hostGroupId === next.groupId && this.host !== null) {
          this.error = null;
          this.emit();
          return;
        }
        this.switching = true;
        this.error = null;
        this.emit();
        await this.halt();
        this.selectedView = next;
        this.remember(next);
        this.launch(next);
        this.switching = false;
      } else {
        this.selectedView = next;
        this.error = null;
        this.remember(next);
      }
      this.emit();
      this.options.onSelected?.(next);
    });
  }

  /** Overlay start: the server's list is in the config now; adopt it. */
  adoptServerGroups(): Promise<void> {
    return this.enqueue(async () => {
      const config = this.options.reload();
      if (config === null) return;
      this.serverAnswered = true;
      this.views = groupViews(config);
      const before = this.selectedView?.groupId ?? null;
      this.selectedView = selectGroup(this.views, this.options.mode, config.lastGroupId ?? this.lastGroupId);
      this.emit();
      if ((this.selectedView?.groupId ?? null) !== before) this.options.onSelected?.(this.selectedView);
    });
  }

  private scheduleRecheck(): void {
    if (this.recheck !== null || this.stopped) return;
    const timer = setTimeout(() => {
      this.recheck = null;
      void this.adoptConfig();
    }, this.options.busyRecheckMs ?? 5_000);
    timer.unref?.();
    this.recheck = timer;
  }

  /**
   * The config file changed under the engine (a `--pair` process saved a group or a host token). Re-reads it
   * and picks up what is new: Host starts the watchers on a token that just arrived when nothing is running,
   * restarts them when the running group's token was replaced, and otherwise leaves a running group alone
   * (the person's picker choice stands). A group whose token the server just refused is not relaunched with
   * the same token.
   */
  adoptConfig(): Promise<void> {
    return this.enqueue(async () => {
      if (this.stopped) return;
      const config = this.options.reload();
      if (config === null) return;
      this.views = groupViews(config);
      const before = this.selectedView?.groupId ?? null;
      if (this.options.mode === 'host') {
        const running =
          this.hostGroupId === null ? undefined : this.views.find((v) => v.groupId === this.hostGroupId);
        if (this.host !== null && running !== undefined && running.token === this.hostToken) {
          this.selectedView = running;
        } else {
          if (this.host?.busy?.()) {
            // A game is on, or its block is not posted yet: the swap waits for the end-of-game post.
            this.options.logger.info(
              'a new host token is saved; applying it after the current game is posted',
            );
            this.scheduleRecheck();
            this.emit();
            return;
          }
          if (this.host !== null) await this.halt();
          const choice = selectGroup(this.views, 'host', config.lastGroupId ?? this.lastGroupId);
          this.selectedView = choice;
          const refusedAgain =
            choice !== null &&
            this.refused !== null &&
            this.refused.groupId === choice.groupId &&
            this.refused.token === choice.token;
          if (choice !== null && !refusedAgain) {
            this.error = null;
            this.launch(choice);
          }
        }
      } else {
        this.selectedView = selectGroup(
          this.views,
          this.options.mode,
          config.lastGroupId ?? this.lastGroupId,
        );
      }
      this.emit();
      if ((this.selectedView?.groupId ?? null) !== before) this.options.onSelected?.(this.selectedView);
    });
  }

  /** Ends the session: stops the watchers and waits for them. Later calls start nothing. */
  stop(): Promise<void> {
    return this.enqueue(async () => {
      this.stopped = true;
      if (this.recheck !== null) clearTimeout(this.recheck);
      this.recheck = null;
      await this.halt();
    });
  }

  private launch(group: GroupView): void {
    if (this.stopped || this.options.startHost === undefined) return;
    try {
      this.host = this.options.startHost(group, (status) => {
        this.onRefused(group, status);
      });
      this.hostGroupId = group.groupId;
      this.hostToken = group.token;
    } catch (error) {
      this.options.logger.error('could not start the watchers', errorFields(error));
      this.host = null;
      this.hostGroupId = null;
    }
  }

  /** Stops the running host and waits until it has fully stopped. */
  private async halt(): Promise<void> {
    const host = this.host;
    this.host = null;
    this.hostGroupId = null;
    if (host === null) return;
    try {
      host.stop();
      await host.run;
    } catch (error) {
      this.options.logger.error('error while stopping the watchers', errorFields(error));
    }
  }

  private onRefused(group: GroupView, status: 401 | 403): void {
    if (status !== 403) return; // 401 keeps its 0.2.x behaviour: one log line, the queue keeps its work
    void this.enqueue(async () => {
      if (this.hostGroupId !== group.groupId) return;
      this.options.logger.error(tokenNoLongerWorks(group.name), { groupId: group.groupId });
      await this.halt();
      this.refused = { groupId: group.groupId, token: group.token };
      this.error = tokenNoLongerWorks(group.name);
      this.emit();
    });
  }

  private remember(group: GroupView): void {
    this.lastGroupId = group.groupId;
    if (group.groupId === LEGACY_GROUP_ID) return;
    try {
      setLastGroup(this.options.configDir, group.groupId);
    } catch (error) {
      this.options.logger.warn('could not save the selected group', errorFields(error));
    }
  }

  private emit(): void {
    try {
      this.options.onState(this.state());
    } catch (error) {
      this.options.logger.error('group state listener threw', errorFields(error));
    }
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.chain.then(task, task);
    this.chain = run.catch(() => undefined);
    return run.catch((error: unknown) => {
      this.options.logger.error('group session task failed', errorFields(error));
    });
  }
}
