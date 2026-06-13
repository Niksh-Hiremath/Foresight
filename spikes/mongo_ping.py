import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv()

client = MongoClient(os.environ["MONGODB_URI"])
db = client["foresight"]
collection = db["smoke"]

inserted = collection.insert_one({"ping": "pong", "status": "ok"})
print(f"Inserted id: {inserted.inserted_id}")

doc = collection.find_one({"_id": inserted.inserted_id})
print(f"Read back  : {doc}")

client.close()
