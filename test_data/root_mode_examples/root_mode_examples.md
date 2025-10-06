# Test Data: Root Mode - No Bundling

## Purpose
This test dataset demonstrates how Root mode processes each file individually without grouping related files together. Each file at the root level becomes a separate Zenodo record.

## Processing Mode Configuration
- **Batch Entity**: root
- **Bundling Enabled**: No (unchecked)
- **Primary Source Extension**: (Not applicable when bundling is disabled)

## File Extensions to Select
- [x] .obj
- [x] .glb
- [x] .jpg
- [x] .fbx

## OBJ File Options
- Add MTL Files: No (unchecked)
- Add Texture Files: No (unchecked)

## Expected Behavior
When the "no_bundling" folder is scanned with Root mode and bundling disabled:
- 4 separate Zenodo records will be created
- Each file (statue_model.obj, building_scan.glb, artifact_photo.png, terrain_data.fbx) becomes its own record
- No dependency scanning or file grouping occurs

## File Count
- Total files: 4
- Primary sources: 4
- Dependencies: 0

## Use Case
This mode is ideal when:
- Each file is independent and self-contained
- Files do not share common resources or dependencies
- Each file represents a distinct research output
