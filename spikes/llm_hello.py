import os
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

api_key = os.environ["LLM_API_KEY"]
base_url = os.environ["LLM_BASE_URL"]
model = os.environ["LLM_MODEL"]

client = OpenAI(api_key=api_key, base_url=base_url)

response = client.chat.completions.create(
    model=model,
    messages=[{"role": "user", "content": "Say hello and tell me what model you are."}],
)

print(response.choices[0].message.content)
