# Test Data: Complex File Dependencies

## Purpose
This collection demonstrates how the application handles different 3D file formats and their associated dependencies, including automatic detection and resolution of external resources.

## Subdirectories

### obj_with_dependencies/
Demonstrates OBJ file processing with:
- Automatic MTL file detection via OBJ parsing
- Multiple texture types (diffuse, normal, roughness, bump)
- Multi-format texture files (.png, .jpg)

### glb_self_contained/
Demonstrates GLB (Binary glTF) format:
- Self-contained binary format with embedded assets
- No external dependency scanning required
- Ideal for archival purposes

### gltf_with_external/
Demonstrates GLTF (Text glTF) format:
- JSON-based format with external references
- Binary buffer files (.bin) as primary dependencies
- Texture images as secondary dependencies
- Automatic JSON parsing and resolution

### fbx_with_materials/
Demonstrates FBX format:
- Common folder structure scanning (Materials/, Textures/)
- Automatic texture discovery in conventional locations
- Support for various texture formats

## General Configuration
Each subdirectory has its own readme with specific settings, but general configuration:
- **Batch Entity**: root
- **Bundle Congruent Patterns**: Yes
- **Bundling Strategy**: stem
- **Primary Source Extension**: Varies by format (.obj, .glb, .gltf, .fbx)

## Key Learning Points
1. Different 3D formats have different dependency structures
2. The application intelligently detects file type and applies appropriate scanning
3. GLB is self-contained; GLTF, OBJ, and FBX may have external dependencies
4. Texture paths are resolved relative to the model file
5. Common folder structures are automatically searched
