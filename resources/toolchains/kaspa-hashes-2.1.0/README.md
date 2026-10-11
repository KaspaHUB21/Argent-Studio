# kaspa-hashes 2.1.0: reproducible MSVC packaging repair

This directory contains the published crates.io package unchanged, plus its omitted MSVC assembly file and ISC license from the immutable official Rusty Kaspa v2.1.0 tag (01b532e8b553523216471682649693af92f0fd16).

The published package includes `.s` files but not `.asm`; its build.rs nevertheless requires keccakf1600_x86-64-msvc.asm on Windows/MSVC. The build script and the three other platform assembly files are byte-identical to the official v2.1.0 tag. All original package files, including hashing implementations, remain unchanged. Cargo cache marker `.cargo-ok` is intentionally excluded.

vendor-provenance.json records the registry archive checksum, every original file checksum, and exact sources and checksums of the two restored files. The package's embedded VCS revision is retained as evidence; it was not publicly resolvable when checked, so restoration uses the explicit official release tag revision instead.

The Argent workspace applies this copy with [patch.crates-io]. Other Kaspa dependencies remain published 2.1.0 crates. No algorithm or consensus rules are modified.
