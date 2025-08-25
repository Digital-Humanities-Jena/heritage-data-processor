# 1. Verify that the API key is set (exclusive for authenticated developers only)
echo "HDP Components API Key: $HDP_COMPONENTS_API_KEY"

# 2. Check current components (before update)
echo "=== Components BEFORE Zenodo Sync ==="
curl -s https://api.modavis.org/hdp/v1/available-components | python3 -m json.tool

# 3. Trigger Zenodo Update
echo "=== Triggering Zenodo update ==="
curl -X POST https://api.modavis.org/hdp/v1/update-available-components \
  -H "X-API-Key: $HDP_COMPONENTS_API_KEY" | python3 -m json.tool

# 4. Verify Components were updated
echo "=== Components AFTER Zenodo sync ==="
curl -s https://api.modavis.org/hdp/v1/available-components | python3 -m json.tool
