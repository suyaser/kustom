import { publish } from './publish.js';
import { buildSea } from './sea.js';

async function release(): Promise<void> {
  const built = await buildSea({ target: 'win-x64' });
  const mib = (built.bytes / (1024 * 1024)).toFixed(1);
  console.log(`built ${built.output} (${mib} MiB, Node ${built.nodeRelease}, version ${built.version})`);
  console.log(`sha256 ${built.sha256}`);
  await publish({ version: built.version });
}

release().catch((error) => {
  console.error('release failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
