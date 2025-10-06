# Test Data: Suffix Removal Bundling Strategy

## Purpose
This demonstrates removing descriptive suffixes to group different views or aspects of the same object.

## Processing Mode Configuration
- **Batch Entity**: root
- **Bundle Congruent Patterns**: Yes (checked)
- **Bundling Strategy**: prefixsuffix
- **Prefix Pattern**: (leave empty)
- **Suffix Pattern**: `_(obverse|reverse|edge)_scan` (removes view descriptors)
- **Use Stem as Variable**: Yes (checked)
- **Primary Source Extension**: .obj

## File Extensions to Select
- [x] .obj
- [x] .mtl

## OBJ File Options
- Add MTL Files: Yes (checked)
- Add Texture Files: No (unchecked)

## Expected Behavior
When scanned:
- 1 Zenodo record will be created (coin)
- Suffixes "_obverse_scan", "_reverse_scan", "_edge_scan" are removed
- All views are grouped under the core identifier "coin"

### Bundle (coin):
- coin_obverse_scan.obj (source)
- coin_reverse_scan.obj (source)
- coin_edge_scan.obj (source)
- coin.mtl (primary)

## File Count
- Total files: 4
- Primary sources: 3 (.obj files - different views)
- Dependencies: 1 (.mtl file)

## Pattern Explanation
- Suffix Pattern: `_(obverse|reverse|edge)_scan`
- `_` - Literal underscore
- `(obverse|reverse|edge)` - Match any of these words
- `_scan` - Literal "_scan"
- Result: Removes descriptive suffixes from filenames
- Core identifier: "coin"

## Alternative Suffix Patterns to Try
- `_(front|back|side)` - Removes view angles
- `_(high|low|medium)Res` - Removes resolution indicators
- `_\d{4}` - Removes year suffixes (e.g., _2024)
