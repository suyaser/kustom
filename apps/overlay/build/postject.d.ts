declare module 'postject' {
  export interface InjectOptions {
    readonly machoSegmentName?: string;
    readonly overwrite?: boolean;
    readonly sentinelFuse?: string;
  }
  export function inject(
    filename: string,
    resourceName: string,
    resourceData: Buffer,
    options?: InjectOptions,
  ): Promise<void>;
}
