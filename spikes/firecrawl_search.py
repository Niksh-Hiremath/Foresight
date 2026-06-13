import os
import requests
from dotenv import load_dotenv

load_dotenv()

url = "https://api.firecrawl.dev/v2/search"

payload = {
    "query": "India edtech market size 2026 competitors",
    "sources": ["web"],
    "limit": 5,
    "scrapeOptions": {
        "formats": ["markdown"],
        "onlyMainContent": True,
    },
}

headers = {
    "Authorization": f"Bearer {os.environ['FIRECRAWL_API_KEY']}",
    "Content-Type": "application/json",
}

response = requests.post(url, json=payload, headers=headers)
data = response.json()

results = data.get("data", {}).get("web", [])
for i, item in enumerate(results, 1):
    print(f"[{i}] {item.get('title', '')}")
    print(f"    URL     : {item.get('url', '')}")
    print(f"    Snippet : {(item.get('description') or item.get('markdown', ''))[:300]}")
    print()

print(f"Total results: {len(results)}")
