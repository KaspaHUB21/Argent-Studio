# Local live editing plan

Available starting with version 0.45.8.

## Interaction contract

All assistance runs locally without AI, network requests or build side effects. AG source editors receive live assistance; other documents keep their existing behavior. Generated files remain read-only. Existing explicit completion and hover services remain available. Ghost completion replaces automatic completion popups for AG; Tab accepts only a visible proposal, Escape dismisses, ordinary indentation still works. No source edits or cursor jumps occur without a user action, except existing bracket pairing.

## Implementation sequence

1. Audit the existing CodeMirror setup and native language service.
2. Implement a conservative browser-local lexical analysis layer for known names, declaration scopes, callable signatures, structural blocks and confident delimiter diagnostics. Ignore comments and string contents. Never imply compiler validation from lexical analysis.
3. Integrate inline completion, call parameter hints, scope-aware occurrence marks, delayed diagnostic marks with explicit quick fixes, active block guides and scroll context into CodeMirror.
4. Test the actual editor with German/English, light/dark themes, read-only documents, typing/Tab/Escape/undo, document replacement, cursor changes, scrolling and teardown.
5. Run existing service, browser and production-build checks. Review screenshots and document limitations.

## Ownership

- Analysis agent: pure analysis module and unit tests.
- UI agent: CodeMirror extension module.
- QA agent: actual-editor browser scenarios.
- Integrator: editor wiring, interaction consistency, documentation and regression checks.

## Acceptance criteria

- Suggestions contain known symbols, never generated business logic; ambiguous or unsupported resolutions do not invent a result.
- Argument information comes from a known callable definition, follows nested calls and disappears outside the call.
- Diagnostics appear after a short pause, clear after edits and offer only explicit, undoable safe fixes. Normal unfinished code must not produce a stream of compiler messages.
- Occurrences refer to the same lexical declaration, excluding unrelated shadowed names, comments and strings.
- Block guides and scroll context do not alter line text, source positions, selection or horizontal layout.
- Input stays responsive; analysis is reused for cursor movement, timers are cancelled on teardown and hidden/unfocused editors do not show intrusive proposals.
- Existing saving, shared structure editing, completion commands and read-only behavior remain intact.

## Scope boundaries

Local lexical assistance is not a full compiler/type checker. Cross-file resolution and complex language constructs must use reliable existing project services or withhold uncertain hints. Full build diagnostics remain authoritative. Installation and publishing are separate user-authorized steps.

## Available behavior

Inline proposals use unique visible names, pinned builtin names and keywords. Same-file owned state fields support bare names and `self` references; lexical shadowing is respected. Explicit completion remains available through the existing completion command with project-aware suggestions.

Parameter hints use local callable definitions or signatures generated from the pinned language service. Nested calls select the appropriate parameter. Unknown calls withhold uncertain information. Press Escape to dismiss; moving or typing resumes assistance.

The local diagnostic pass checks delimiter balance and unclosed strings/comments after 550 ms. An unfinished construct on the active line is quiet until the cursor leaves that line. An extra closing delimiter can be removed through the gutter action; the change is undoable and enters the ordinary save history. This does not run the compiler or write build files.

The innermost recognized block receives a subtle guide. Scrolling past its heading shows the surrounding context above the viewport. Neither changes the source or cursor position.

## Deliberate limitations

This pass is lexical and document-local. It does not perform complete type checking, imported/inherited state inference or general receiver-member inference. Such cases retain the existing explicit project completion/hover support where available; compilation remains the authoritative validation. A displayed quick fix is a suggested edit, not proof that the whole program is correct.

## Maintenance

After updating the pinned Argent language service, run `node scripts/sync-live-builtins.mjs`. The metadata drift test prevents stale builtin signatures from silently reaching the editor.

Additional binding, call, type, control-flow and import checks are documented in [semantic checks](SEMANTIC-CHECKS.md). They extend the lexical layer described above.

State record keys use the fields of the declared same-file state (including same-file expanded states), rather than ordinary local-name candidates. Already populated fields are excluded. For example, `red` in a `TicketState` initializer proposes `redeemed` even when `redeem` and `redeemed_ticket` are also in scope. Value expressions retain ordinary completion.
