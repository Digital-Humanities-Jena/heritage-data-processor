# Test Data: Prefix Removal Bundling Strategy

## Purpose
This demonstrates removing version number prefixes to group different versions of the same artifact.

## Processing Mode Configuration
- **Batch Entity**: root
- **Bundle Congruent Patterns**: Yes (checked)
- **Bundling Strategy**: prefixsuffix
- **Prefix Pattern**: `v\d+_` (removes version prefixes like v1_, v2_, v3_)
- **Suffix Pattern**: (leave empty)
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
- 1 Zenodo record will be created (pottery_fragment)
- Version prefixes "v1_", "v2_", "v3_" are removed from filenames
- All versions are grouped under the core identifier "pottery_fragment"

### Bundle (pottery_fragment):
- v1_pottery_fragment.obj (source)
- v2_pottery_fragment.obj (source)
- v3_pottery_fragment.obj (source)
- pottery_fragment.mtl (primary)

## File Count
- Total files: 4
- Primary sources: 3 (.obj files - multiple versions)
- Dependencies: 1 (.mtl file)

## Pattern Explanation
- Prefix Pattern: `v\d+_`
- `v` - Literal "v" character
- `\d+` - One or more digits
- `_` - Literal underscore
- Result: Removes "v1_", "v2_", "v3_" from filenames
- Core identifier: "pottery_fragment"

## Alternative Prefix Patterns to Try
- `rev\d+_` - Removes revision numbers (rev01_, rev02_)
- `[A-Z]\d+_` - Removes catalog IDs (A001_, B042_)
- `n\d+_` - Removes numeric prefixes (n1_, n23_)
