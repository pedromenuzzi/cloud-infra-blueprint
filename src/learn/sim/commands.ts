/**
 * The simulated terminal's commands that read or reshape the state without
 * planning anything: `terraform workspace` (new, select, list, show,
 * delete), `terraform output` (all of them, one by name, `-raw`, `-json`)
 * and `terraform show` (the state, or a plan saved with `-out`). Pure, like
 * the simulator: the lesson's state in, the lines and the new state out.
 *
 * Workspaces live inside the lesson's one state (types.ts `SimState`): the
 * current workspace's resources at the top, as before workspaces existed,
 * and the others' states under `workspaces`.
 */
import { parseProject } from '@/hcl/parser';
import type { Files, SimState } from '../types';
import { isObject, type Val } from './eval';
import { decode, line, outputValueLines, problemLines, stateLines, type Line } from './render';
import type { SavedPlan } from './simulate';

export interface CommandResult {
  ok: boolean;
  lines: Line[];
  /** the state it leaves (undefined: unchanged) */
  state?: SimState | null;
}

const EMPTY: SimState = { serial: 0, resources: {}, outputs: {} };

export const workspaceOf = (state: SimState | null): string => state?.workspace ?? 'default';

/** every workspace, `default` first */
export function workspaceNames(state: SimState | null): string[] {
  const others = Object.keys(state?.workspaces ?? {}).filter((n) => n !== 'default');
  const current = workspaceOf(state);
  return ['default', ...[...new Set([...others, ...(current === 'default' ? [] : [current])])].sort()];
}

/** the state with `name` as the current workspace: its state comes up, the current one joins the others */
function switchTo(state: SimState | null, name: string): SimState {
  const { workspace: _current, workspaces, ...own } = state ?? EMPTY;
  const others: Record<string, SimState> = { ...workspaces, [workspaceOf(state)]: own };
  const next = others[name] ?? EMPTY;
  delete others[name];
  return { ...next, ...(name === 'default' ? {} : { workspace: name }), workspaces: others };
}

const said = (...texts: string[]): Line[] => texts.map((t) => line(t));
const failed = (...texts: string[]): CommandResult => ({ ok: false, lines: texts.map((t) => line(t, 'error')) });

const USAGE = [
  'Usage: terraform [global options] workspace',
  '',
  '  new, list, show, select and delete Terraform workspaces.',
  '',
  'Subcommands:',
  '    delete    Delete a workspace',
  '    list      List Workspaces',
  '    new       Create a new workspace',
  '    select    Select a workspace',
  '    show      Show the name of the current workspace',
];

/** `terraform workspace …` (`args`: what follows `workspace`) */
export function workspaceCommand(args: string[], state: SimState | null): CommandResult {
  const flags = args.filter((a) => a.startsWith('-'));
  const [sub, name] = args.filter((a) => !a.startsWith('-'));
  const names = workspaceNames(state);
  const current = workspaceOf(state);
  if (sub === 'show') return { ok: true, lines: said(current) };
  if (sub === 'list') return { ok: true, lines: [...names.map((n) => line(`${n === current ? '*' : ' '} ${n}`)), line()] };
  if ((sub === 'new' || sub === 'select' || sub === 'delete') && name === undefined) {
    return failed(`Expected a single argument: NAME.`, '', ...USAGE);
  }
  if (sub !== 'new' && sub !== 'select' && sub !== 'delete') return { ok: sub === undefined, lines: said(...USAGE) };
  if (!/^[\w.-]+$/.test(name)) {
    return failed(`The workspace name "${name}" is not allowed. The name must contain only URL safe`, 'characters, contain no path separators, and not be an empty string.');
  }
  const exists = names.includes(name);
  const missing = () => failed(`Workspace "${name}" doesn't exist.`, '', 'You can create this workspace with the "new" subcommand ', 'or include the "-or-create" flag with the "select" subcommand.');
  if (sub === 'new') {
    if (exists) return failed(`Workspace "${name}" already exists`);
    return {
      ok: true,
      state: switchTo(state, name),
      lines: [
        line(`Created and switched to workspace "${name}"!`, 'success'),
        line(),
        line("You're now on a new, empty workspace. Workspaces isolate their state,"),
        line('so if you run "terraform plan" Terraform will not see any existing state'),
        line('for this configuration.'),
      ],
    };
  }
  if (sub === 'select') {
    if (!exists && !flags.includes('-or-create')) return missing();
    if (!exists) return workspaceCommand(['new', name], state);
    return { ok: true, state: name === current ? undefined : switchTo(state, name), lines: [line(`Switched to workspace "${name}".`, 'success')] };
  }
  // delete
  if (!exists) return missing();
  if (name === current) {
    return failed(`Workspace "${name}" is your active workspace.`, '', 'You cannot delete the currently active workspace. Please switch', 'to another workspace and try again.');
  }
  if (name === 'default') return failed("Can't delete the default workspace.");
  const held = Object.keys(state?.workspaces?.[name]?.resources ?? {});
  if (held.length > 0 && !flags.includes('-force')) {
    return {
      ok: false,
      lines: problemLines({
        severity: 'error',
        summary: 'Workspace is not empty',
        detail: [
          `Workspace "${name}" is currently tracking the following resource instances:`,
          ...held.map((a) => `  - ${a}`),
          '',
          'Deleting this workspace would cause Terraform to lose track of any associated remote',
          'objects, which would then require you to delete them manually outside of Terraform.',
          'You should destroy these objects with Terraform before deleting the workspace.',
          '',
          'If you want to delete this workspace anyway, and have Terraform forget about these',
          'managed objects, use the -force option to disable this safety check.',
        ].join('\n'),
      }),
    };
  }
  const others = { ...state!.workspaces };
  delete others[name];
  return { ok: true, state: { ...state!, workspaces: others }, lines: [line(`Deleted workspace "${name}"!`, 'success')] };
}

/** the root outputs the code marks sensitive (the state keeps values only, so the code says which are secret) */
export const sensitiveOutputs = (files: Files): Set<string> =>
  new Set(
    parseProject(Object.fromEntries(Object.entries(files).filter(([f]) => f.endsWith('.tf'))))
      .ir.outputs.filter((o) => o.args.sensitive?.kind === 'literal' && o.args.sensitive.value === true)
      .map((o) => o.name),
  );

/** a value's type as `terraform output -json` names it */
const typeOf = (v: Val): unknown =>
  typeof v === 'string'
    ? 'string'
    : typeof v === 'number'
      ? 'number'
      : typeof v === 'boolean'
        ? 'bool'
        : Array.isArray(v)
          ? ['tuple', v.map(typeOf)]
          : isObject(v)
            ? ['object', Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeOf(x)]))]
            : 'dynamic';

/**
 * `terraform output`: every output (sensitive ones as `<sensitive>`), or
 * one by name: then even a sensitive one is shown, as the real CLI does;
 * `-raw` prints a string as it is, `-json` as JSON.
 */
export function outputCommand(args: string[], files: Files, state: SimState | null): CommandResult {
  const raw = args.includes('-raw');
  const json = args.includes('-json');
  const [name] = args.filter((a) => !a.startsWith('-'));
  const outputs = state?.outputs ?? {};
  const secret = sensitiveOutputs(files);
  if (name === undefined) {
    const names = Object.keys(outputs).sort();
    if (names.length === 0) {
      return {
        ok: true,
        lines: problemLines({
          severity: 'warning',
          summary: 'No outputs found',
          detail:
            'The state file either has no outputs defined, or all the defined outputs\nare empty. Please define an output in your configuration with the `output`\nkeyword and run `terraform apply` for it to become available.',
        }),
      };
    }
    if (json) {
      const all = Object.fromEntries(names.map((n) => [n, { sensitive: secret.has(n), type: typeOf(decode(outputs[n])), value: decode(outputs[n]) }]));
      return { ok: true, lines: said(...JSON.stringify(all, null, 2).split('\n')) };
    }
    return { ok: true, lines: names.flatMap((n) => outputValueLines(n, decode(outputs[n]), secret.has(n))) };
  }
  if (outputs[name] === undefined) {
    return {
      ok: false,
      lines: problemLines({
        severity: 'error',
        summary: `Output "${name}" not found`,
        detail:
          'The output variable requested could not be found in the state file. If\nyou recently added this to your configuration, be sure to run `terraform\napply`, since the state won\'t be updated with new output variables until\nthat command is run.',
      }),
    };
  }
  const value = decode(outputs[name]);
  if (json) return { ok: true, lines: said(...JSON.stringify(value, null, 2).split('\n')) };
  if (raw) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return { ok: true, lines: said(...String(value).split('\n')) };
    return {
      ok: false,
      lines: problemLines({
        severity: 'error',
        summary: 'Unsupported value for raw output',
        detail: `The -raw option only supports strings, numbers, and boolean values, but output value\n"${name}" is ${Array.isArray(value) ? 'a list' : 'an object'}.\n\nUse the -json option for machine-readable representations of output values that have\ncomplex types.`,
      }),
    };
  }
  const [first, ...rest] = outputValueLines(name, value, false);
  return { ok: true, lines: [line(first.text.slice(name.length + 3)), ...rest] };
}

/** `terraform show`: the state in HCL, or the plan saved under `name` */
export function showCommand(args: string[], files: Files, state: SimState | null, saved: (name: string) => SavedPlan | undefined): CommandResult {
  const [name] = args.filter((a) => !a.startsWith('-'));
  if (name === undefined) return { ok: true, lines: stateLines(state?.resources ?? {}, state?.outputs ?? {}, sensitiveOutputs(files)) };
  const plan = saved(name);
  if (plan) return { ok: true, lines: plan.lines };
  return {
    ok: false,
    lines: problemLines({
      severity: 'error',
      summary: 'Failed to read the given file as a state or plan file',
      detail: `State read error: Error loading statefile: open ${name}: no such file or directory\n\nPlan read error: stat ${name}: no such file or directory`,
    }),
  };
}
