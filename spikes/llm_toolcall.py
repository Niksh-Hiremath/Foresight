import os
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

client = OpenAI(
    api_key=os.environ["LLM_API_KEY"],
    base_url=os.environ["LLM_BASE_URL"],
)
model = os.environ["LLM_MODEL"]

tools = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get the current weather for a city.",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {"type": "string", "description": "The city name."}
                },
                "required": ["city"],
            },
        },
    }
]

response = client.chat.completions.create(
    model=model,
    messages=[{"role": "user", "content": "What's the weather like in Mumbai right now?"}],
    tools=tools,
    tool_choice="auto",
)

message = response.choices[0].message

if message.tool_calls:
    tc = message.tool_calls[0]
    print("✅ Valid tool call received")
    print(f"   Function : {tc.function.name}")
    print(f"   Arguments: {tc.function.arguments}")
else:
    print("❌ No tool call returned — model responded with text instead:")
    print(message.content)
