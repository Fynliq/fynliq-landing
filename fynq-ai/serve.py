import os
from fastapi import FastAPI,Header,HTTPException
from pydantic import BaseModel,Field
from transformers import AutoTokenizer,AutoModelForCausalLM,pipeline
from peft import PeftModel
from train import SYSTEM
from guards import bearer_matches,contains_ssn
app=FastAPI(title="FYNQ AI 1.0",version="1.0.0")
model_id=os.getenv("FYNQ_BASE_MODEL","Qwen/Qwen2.5-1.5B-Instruct")
adapter=os.getenv("FYNQ_ADAPTER","artifacts/fynq-ai-1-lora")
model=None;tokenizer=None
class Question(BaseModel):
 question:str=Field(min_length=1,max_length=1500)
@app.get("/health")
def health():return {"name":"FYNQ AI 1.0","ready":model is not None}
@app.on_event("startup")
def startup():
 global model,tokenizer
 tokenizer=AutoTokenizer.from_pretrained(model_id)
 model=PeftModel.from_pretrained(AutoModelForCausalLM.from_pretrained(model_id,device_map="auto",torch_dtype="auto"),adapter);model.eval()
@app.post("/v1/financial-aid")
def answer(body:Question,authorization:str=Header(default="")):
 if not bearer_matches(authorization,os.getenv("FYNQ_INFERENCE_KEY","")):raise HTTPException(401,"Unauthorized")
 import torch
 if contains_ssn(body.question):raise HTTPException(400,"Do not send SSNs")
 tokens=tokenizer.apply_chat_template([{"role":"system","content":SYSTEM},{"role":"user","content":body.question}],return_tensors="pt",add_generation_prompt=True).to(model.device)
 with torch.inference_mode():result=model.generate(tokens,max_new_tokens=300,do_sample=False,pad_token_id=tokenizer.eos_token_id)
 return {"model":"fynq-ai-1.0","answer":tokenizer.decode(result[0][tokens.shape[-1]:],skip_special_tokens=True),"disclaimer":"Confirm details with StudentAid.gov and your school."}
