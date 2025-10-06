# Test Data: Bundling Strategy Demonstrations

## Purpose
This collection provides clear, focused examples of each bundling strategy supported by the application. Use these examples to understand how different strategies extract grouping keys from filenames.

## Bundling Strategies Overview

### 1. Stem (Default)
**Folder**: Not included here (see root_mode_examples/stem_bundling)
- Groups files with identical filename stems
- Example: model.obj, model.mtl, model_texture.png → Bundle: "model"

### 2. Pattern
**Folder**: pattern_matching/
- Uses regex to match and extract grouping identifiers
- Supports capture groups for precise extraction
- Example: Athens_Temple_Section_A.obj → Bundle: "Athens"

### 3. Prefix/Suffix Removal
**Folders**: prefix_removal/, suffix_removal/
- Removes variable prefixes and/or suffixes to reveal core identifier
- Prefix example: v1_pottery.obj, v2_pottery.obj → Bundle: "pottery"
- Suffix example: coin_obverse.obj, coin_reverse.obj → Bundle: "coin"
- Can be used together or separately

### 4. Core Identifier
**Folder**: core_identifier/
- Extracts a specific pattern that may appear anywhere in the filename
- Example: site042_main.fbx, site042_detail.obj → Bundle: "site042"

## Configuration Differences

| Strategy | Primary Config | Best Use Case |
|----------|---------------|---------------|
| Stem | None (default) | Files with exact matching base names |
| Pattern | Regex pattern | Files with embedded identifiers in consistent positions |
| Prefix/Suffix | Prefix and/or suffix patterns | Files with version numbers or quality indicators |
| Core Identifier | Core pattern to extract | Files with IDs that may appear in variable contexts |

## Testing Workflow
1. Start with the simplest strategy (stem) and check if it meets your needs
2. If filenames have additional variable parts, try prefix/suffix removal
3. If identifiers are embedded in complex names, use pattern matching
4. For maximum flexibility with variable file structures, use core identifier

## All Test Cases
For each strategy subfolder, refer to the individual readme.txt for:
- Exact wizard configuration settings
- Expected bundling results
- Pattern syntax explanations
- Alternative patterns to experiment with
