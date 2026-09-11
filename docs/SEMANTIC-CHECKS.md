# Semantic live checks

Available starting with version 0.45.8.

## Design

The editor runs a debounced local analysis after typing pauses. Syntax, bindings, signatures, project imports and control flow are separate layers. A diagnostic is emitted only when the layer has enough information; a missing dependency disables dependent unknown-name claims. The compiler remains authoritative.

The eight checks are implemented in coordinated stages:

1. Resolve local bindings and imported declarations. Detect unknown expression names and propose a unique nearby spelling; identify unused bindings, shadowing and duplicate declarations.
2. Check completed calls against known signatures, infer only provable primitive types, and inspect understood return paths. Fade unreachable statements.
3. Resolve actual AG module and named-actor imports from current unsaved buffers or bounded local reads. Distinguish confirmed missing files from unreadable or unsupported imports.
4. Present hints through small source marks, faded unused code and explicit gutter actions. Related-declaration links navigate without editing. Corrections remain explicit and undoable.
5. Verify module fixtures, real compiler behavior, editor interaction, delayed results, themes/languages, regression workflows and native packaging.

## Runtime behavior

The analysis waits 550 ms. Document changes cancel older results; project revisions and editor destruction invalidate pending reads. Changes to another open document trigger dependent rechecks. Focusing an editor refreshes its project context. The inspection performs no build, file write, API request or AI inference.

Imports prefer unsaved buffers. Disk reads reuse the existing bounded, no-follow scoped source reader. The standard library is an explicit trusted path. Missing, restricted and unresolved cases are distinct: access failures never become false missing-file claims. Recursive imports have count and text-size limits.

## Diagnostic contract

Every item contains a code, source range, severity and German/English text. Optional fields provide a safe explicit replacement, fading or related source locations. Warning marks are understated; unused and unreachable source is slightly faded. Names, paths and types remain verbatim rather than translated. The user can inspect a mark or gutter action without opening another panel.

## Expected limits

This is a conservative static assistant, not a replacement compiler. General type inference, all language-specific coercions, arbitrary receiver calls and unknown control-flow constructs are not guessed. Missing-return and unused-code notices are editor advisories and must be checked against the pinned compiler's actual behavior. Complex or unresolved constructs remain available to the normal build diagnostics.

## Validation

82 module tests, 16 existing language service tests and 72 browser scenarios passed. The browser suite includes actual application save/undo behavior, unsaved imported-file edits, project refresh, stale asynchronous results, read-only state and editor destruction. Four localized theme screenshots were reviewed. The production frontend and native Windows builds passed, including native UI/backend smoke checks and all bundled examples.

Eight isolated fixtures were run against the bundled compiler: a valid helper succeeded; wrong arity, wrong primitive type, missing return, empty return, partial branch return, both-branch returns and statements after a return failed. The pinned SilverScript compiler requires final return placement. The local control-flow hints do not certify otherwise-invalid branch-return constructs as compiler-valid.

The inline type pass currently handles provable primitive types and known call signatures. Receiver calls, uncertain coercions and unsupported control forms are withheld. Import reads denied by scope/link restrictions, resource limits or unsupported roots remain unresolved; missing ancestor directories cannot always be distinguished from denied access and therefore do not generate a definitive missing-file error. The code pane inside the structure view retains the original lexical assistance because it edits source fragments without complete semantic context.

Release builds are validated separately on Windows and both macOS architectures before publication.
