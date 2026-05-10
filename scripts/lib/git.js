import { spawn } from 'node:child_process';
import { REPO_ROOT, c } from './util.js';

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: REPO_ROOT, stdio: opts.inherit ? 'inherit' : 'pipe' });
    let stdout = '', stderr = '';
    if (!opts.inherit) {
      p.stdout.on('data', d => { stdout += d.toString(); });
      p.stderr.on('data', d => { stderr += d.toString(); });
    }
    p.on('error', reject);
    p.on('close', code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}\n${stderr}`));
    });
  });
}

export async function statusShort() {
  const { stdout } = await run('git', ['status', '--short']);
  return stdout.trim();
}

export async function diffStat(files) {
  try {
    const { stdout } = await run('git', ['diff', '--stat', '--', ...files]);
    return stdout.trim();
  } catch { return ''; }
}

export async function commitAndPush({ files, message, push = true, dryRun = false }) {
  if (dryRun) {
    console.log(c.dim('  (dry-run) would commit:'));
    for (const f of files) console.log(c.dim(`    ${f}`));
    console.log(c.dim(`  (dry-run) message: ${message}`));
    if (push) console.log(c.dim('  (dry-run) would push to origin'));
    return { skipped: true };
  }

  await run('git', ['add', '--', ...files]);

  // Check there's actually something staged.
  const { stdout: staged } = await run('git', ['diff', '--cached', '--name-only']);
  if (!staged.trim()) {
    console.log(c.yellow('  Nothing staged — skipping commit.'));
    return { skipped: true };
  }

  await run('git', ['commit', '-m', message]);
  console.log(c.green('  ✓ Commit created'));

  if (push) {
    await run('git', ['push'], { inherit: true });
    console.log(c.green('  ✓ Pushed to origin'));
  }

  return { skipped: false };
}
