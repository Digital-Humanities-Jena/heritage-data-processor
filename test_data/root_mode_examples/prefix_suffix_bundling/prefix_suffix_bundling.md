# Test Data: Root Mode - Prefix/Suffix Bundling

## Purpose
This test dataset demonstrates how Prefix/Suffix bundling removes variable prefixes and suffixes from filenames to group related files with different versions or quality levels.

## Processing Mode Configuration
- **Batch Entity**: root
- **Bundle Congruent Patterns**: Yes (checked)
- **Bundling Strategy**: prefixsuffix
- **Prefix Pattern**: `n\d+_`
- **Suffix Pattern**: `_(hiRes|lowRes)`
- **Use Stem as Variable**: Yes (checked) - treats prefix/suffix as regex
- **Primary Source Extension**: .obj

## File Extensions to Select
- [x] .obj
- [x] .mtl

## OBJ File Options
- Add MTL Files: Yes (checked)
- Add Texture Files: No (unchecked)

## Expected Behavior
When scanned with Root mode and prefix/suffix bundling:
- 2 separate Zenodo records will be created (vase and coin)
- The prefix "n001_", "n002_" and suffix "_hiRes", "_lowRes" are removed
- Core identifiers "vase" and "coin" are extracted for grouping

### Bundle 1 (vase):
- n001_vase_hiRes.obj (source)
- n001_vase_lowRes.obj (source)
- n001_vase.mtl (primary)

### Bundle 2 (coin):
- n002_coin_hiRes.obj (source)
- n002_coin_lowRes.obj (source)
- n002_coin.mtl (primary)

## File Count
- Total files: 6
- Primary sources: 4 (.obj files - multiple resolutions)
- Dependencies: 2 (.mtl files)

## Use Case
This mode is ideal when:
- Files have version numbers, catalog IDs, or quality indicators
- Multiple variants (resolutions, versions) of the same object exist
- Core identifiers need to be extracted by removing variable parts
