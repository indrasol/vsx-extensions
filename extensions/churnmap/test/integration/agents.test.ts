// The last mile: AI prompts, the agent context file and (below) the MCP server.
import * as assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import * as vscode from 'vscode';
import type { ConnectOutcome } from '../../src/ai/addToAgent.js';
import type { PromptOutcome } from '../../src/ai/aiPrompt.js';
import type { ExportOutcome } from '../../src/ai/exportForAgents.js';
import type { TestApi } from '../../src/extension.js';
import { callTool, mcpClient } from './helpers.js';

const EXTENSION_ID = 'Indrasol.churnmap';
const TOP = 'src/core/engine.js';

async function api(): Promise<TestApi> {
  const ext = vscode.extensions.getExtension<TestApi | undefined>(EXTENSION_ID);
  assert.ok(ext, `${EXTENSION_ID} is not installed`);
  const exports = await ext.activate();
  assert.ok(exports, 'the test API is only returned in test mode');
  return exports;
}

function root(): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'the fixture repository is not open');
  return folder.uri.fsPath;
}

/** Files these tests may create in the fixture; removed afterwards so other suites see a clean tree. */
const CREATED = ['.churnmap', 'AGENTS.md', 'CLAUDE.md', '.cursor', '.github', '.mcp.json'];

suite('AI prompts and the agent context file', () => {
  suiteSetup(async () => {
    const testApi = await api();
    if (!testApi.__analysis()) await vscode.commands.executeCommand('churnmap.build');
    assert.ok(testApi.__analysis(), 'the build did not finish');
  });

  suiteTeardown(async () => {
    for (const name of CREATED) rmSync(join(root(), name), { recursive: true, force: true });
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('createAIPrompt opens an untitled Markdown prompt titled "AI prompt · <file>", then copies it', async () => {
    const testApi = await api();
    const asked: string[][] = [];
    const restore = testApi.__prompts({
      info: (_message, ...actions) => {
        asked.push(actions);
        return Promise.resolve(actions.includes('Copy prompt') ? 'Copy prompt' : undefined);
      },
    });
    try {
      await vscode.env.clipboard.writeText('');
      const outcome = await vscode.commands.executeCommand<PromptOutcome | undefined>(
        'churnmap.createAIPrompt',
        TOP,
        'refactor-plan',
      );
      assert.ok(outcome, 'createAIPrompt returned nothing');
      const doc = vscode.window.activeTextEditor?.document;
      assert.ok(doc, 'no editor opened');
      assert.equal(doc.isUntitled, true);
      assert.equal(doc.languageId, 'markdown');
      const text = doc.getText();
      assert.match(text, /^AI prompt · engine\.js\nChurnmap · \S+ · last 90 days\n/);
      // Plain sentences with their numbers, never "top N%".
      assert.match(text, /\(more often than \d+% of files\)/);
      assert.doesNotMatch(text, /\btop \d+%/);
      assert.ok(text.includes('### `src/core/engine.js`'));
      // The newest commit subject touching the engine, from the cached subjects.
      assert.ok(text.includes('- Engine: metrics'), text);
      assert.ok(text.includes('**without changing behaviour**'));
      assert.equal(await vscode.env.clipboard.readText(), text);
      assert.deepEqual(asked.at(-1)?.slice(0, 1), ['Copy prompt']);
      assert.ok(asked.at(-1)?.includes('Done'));
      assert.equal(outcome.action, 'Copy prompt');
    } finally {
      restore();
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    }
  });

  test('createAIPrompt from the palette asks for the hotspot and the template, and remembers the template', async () => {
    const testApi = await api();
    const restore = testApi.__prompts({
      pick: (items) =>
        Promise.resolve(
          items.find((i) => i.label === TOP) ?? items.find((i) => i.label === 'Tests first'),
        ),
      info: () => Promise.resolve('Done'),
    });
    try {
      const outcome = await vscode.commands.executeCommand<PromptOutcome | undefined>(
        'churnmap.createAIPrompt',
      );
      assert.equal(outcome?.template, 'tests-first');
      assert.ok(outcome.brief.includes('characterisation tests'));
    } finally {
      restore();
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    }
  });

  test('exportForAgents writes both files and updates AGENTS.md idempotently', async () => {
    const testApi = await api();
    const dir = root();
    writeFileSync(join(dir, 'AGENTS.md'), '# Agents\n\nHouse rules.\n');
    const questions: string[] = [];
    const restore = testApi.__prompts({
      pickMany: (items) => Promise.resolve(items.filter((i) => i.label === 'AGENTS.md')),
      info: (message) => {
        questions.push(message);
        return Promise.resolve(message.includes('.gitignore') ? 'No, commit it' : undefined);
      },
    });
    try {
      for (let i = 0; i < 2; i++) {
        const outcome = await vscode.commands.executeCommand<ExportOutcome | undefined>(
          'churnmap.exportForAgents',
        );
        assert.ok(outcome, 'export returned nothing');
      }
      const json = JSON.parse(readFileSync(join(dir, '.churnmap', 'hotspots.json'), 'utf8')) as {
        version: number;
        top: { rank: number; path: string }[];
      };
      assert.equal(json.version, 1);
      assert.equal(json.top[0]?.path, TOP);
      assert.ok(readFileSync(join(dir, '.churnmap', 'HOTSPOTS.md'), 'utf8').includes(TOP));
      const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
      assert.ok(agents.startsWith('# Agents\n\nHouse rules.\n\n<!-- churnmap:start -->'));
      assert.equal(agents.split('<!-- churnmap:start -->').length, 2, 'the block was duplicated');
      // Nothing else was written: no other notes, and .gitignore left alone ("No, commit it").
      for (const name of ['CLAUDE.md', '.cursor', '.github', '.gitignore']) {
        assert.equal(existsSync(join(dir, name)), false, `${name} was written`);
      }
      // The .gitignore question was asked once and remembered.
      assert.equal(questions.filter((q) => q.includes('.gitignore')).length, 1);
    } finally {
      restore();
    }
  });

  test('a build rewrites the context files once they exist', async () => {
    const md = join(root(), '.churnmap', 'HOTSPOTS.md');
    rmSync(md, { force: true });
    await vscode.commands.executeCommand('churnmap.build');
    assert.ok(existsSync(md), 'the build did not refresh HOTSPOTS.md');
  });
});

suite('the local MCP server', () => {
  suiteTeardown(() => {
    for (const name of CREATED) rmSync(join(root(), name), { recursive: true, force: true });
  });

  test('addToAgent (Cursor) writes .cursor/mcp.json with absolute paths and keeps other servers', async () => {
    const testApi = await api();
    const dir = root();
    mkdirSync(join(dir, '.cursor'), { recursive: true });
    writeFileSync(
      join(dir, '.cursor', 'mcp.json'),
      JSON.stringify({ mcpServers: { other: { command: 'other-server' } }, keep: 1 }),
    );
    // The rules-file question: checked by default, accepted as offered.
    const offered: { label: string; picked: boolean | undefined }[][] = [];
    const restore = testApi.__prompts({
      pickMany: (items) => {
        offered.push(items.map((i) => ({ label: i.label, picked: i.picked })));
        return Promise.resolve(items.filter((i) => i.picked === true));
      },
    });
    try {
      for (let i = 0; i < 2; i++) {
        const outcome = await vscode.commands.executeCommand<ConnectOutcome | undefined>(
          'churnmap.addToAgent',
          'cursor',
        );
        assert.equal(outcome?.file, join(dir, '.cursor', 'mcp.json'));
        assert.equal(outcome.rules, join(dir, '.cursor', 'rules', 'churnmap.mdc'));
      }
    } finally {
      restore();
    }
    assert.deepEqual(offered[0], [
      { label: 'Also write .cursor/rules/churnmap.mdc', picked: true },
    ]);
    const rule = readFileSync(join(dir, '.cursor', 'rules', 'churnmap.mdc'), 'utf8');
    assert.ok(
      rule.startsWith('---\ndescription: Code hotspots from Churnmap\nalwaysApply: true\n---'),
    );
    assert.ok(
      rule.includes(
        'call the `churnmap` MCP tools (`list_hotspots`, `explain_file`) instead of running git commands.',
      ),
      rule,
    );
    assert.equal(rule.split('<!-- churnmap:start -->').length, 2, 'the block was duplicated');
    const config = JSON.parse(readFileSync(join(dir, '.cursor', 'mcp.json'), 'utf8')) as {
      mcpServers: Record<string, { command: string; args?: string[] }>;
      keep: number;
    };
    assert.equal(config.keep, 1);
    assert.equal(config.mcpServers.other?.command, 'other-server');
    const entry = config.mcpServers.churnmap;
    assert.ok(entry, 'no churnmap server in .cursor/mcp.json');
    assert.equal(entry.command, 'node');
    // The workspace folder is the server's whole scope, wherever the agent starts it.
    assert.deepEqual(entry.args, [
      testApi.__mcpServerPath(),
      '--cache-dir',
      testApi.__storageDir(),
      '--workspace',
      dir,
    ]);
    assert.ok(isAbsolute(testApi.__mcpServerPath()));
    assert.ok(existsSync(testApi.__mcpServerPath()), 'dist/mcp-server.js was not built');
  });

  test('end to end over stdio: stale → build → fresh with the extension’s rank 1, then a warm start from its cache', async () => {
    const testApi = await api();
    await vscode.commands.executeCommand('churnmap.build');
    const rank1 = testApi.__analysis()?.top[0]?.file.path;
    assert.equal(rank1, TOP);
    await vscode.commands.executeCommand('churnmap.clearCache');

    const client = await mcpClient(testApi.__mcpServerPath(), testApi.__storageDir(), root());
    try {
      const { tools } = await client.listTools();
      assert.equal(tools.length, 6);
      for (const tool of tools) assert.match(tool.description ?? '', /^Use this /, tool.name);
      const before = await callTool(client, 'list_hotspots');
      assert.equal(before.scope, `Scope: ${basename(root())} repository, 1 repository`);
      assert.equal(before.data?.stale, true);
      assert.match(before.texts[0] ?? '', /^Cache is missing for .+\. Call `build`/);

      const built = await callTool(client, 'build');
      assert.equal(built.isError, false, built.texts.join('\n'));
      console.log(`      ${built.texts[0] ?? ''}`);

      const after = await callTool(client, 'list_hotspots');
      assert.equal(after.data?.stale, false);
      // The assertion above narrowed `data` (it is defined here).
      const top = after.data.top as { path: string }[];
      assert.equal(top.map((t) => t.path)[0], rank1);

      const prompt = await callTool(client, 'get_prompt', { path: TOP, template: 'refactor-plan' });
      assert.match(prompt.texts[0] ?? '', /^AI prompt · engine\.js\n/);
      const changes = await callTool(client, 'hotspots_in_changes', {
        paths: [TOP, 'README.md'],
      });
      assert.deepEqual(
        (changes.data?.hotspots as { path: string }[]).map((h) => h.path),
        [TOP],
      );
    } finally {
      await client.close();
    }

    // The extension warm-starts from the cache the server wrote: no process, same rank 1.
    const warm = await testApi.__warmStart();
    assert.equal(warm.outcome, 'loaded');
    assert.equal(typeof warm.timings?.cache, 'number');
    assert.equal(warm.spawns, 0);
  });

  test('the server refuses folders that are not git repositories, and ".."', async () => {
    const testApi = await api();
    const client = await mcpClient(testApi.__mcpServerPath(), testApi.__storageDir(), root());
    try {
      for (const repo of ['/', `${root()}/../elsewhere`, join(root(), 'no-such-folder')]) {
        const res = await callTool(client, 'build', { repo });
        assert.equal(res.isError, true, `${repo}: ${res.texts.join(' ')}`);
        assert.match(res.texts[0] ?? '', /^Refused /);
      }
    } finally {
      await client.close();
    }
  });
});
