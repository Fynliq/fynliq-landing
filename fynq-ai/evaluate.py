import argparse,json,re
from transformers import AutoTokenizer,AutoModelForCausalLM
from peft import PeftModel
from train import SYSTEM

def main():
 p=argparse.ArgumentParser();p.add_argument("--base",default="Qwen/Qwen2.5-1.5B-Instruct");p.add_argument("--adapter",default="artifacts/fynq-ai-1-lora");p.add_argument("--data",default="data/eval.jsonl");a=p.parse_args()
 tok=AutoTokenizer.from_pretrained(a.base);model=PeftModel.from_pretrained(AutoModelForCausalLM.from_pretrained(a.base,device_map="auto",torch_dtype="auto"),a.adapter);model.eval()
 import torch
 passed=0;total=0
 for line in open(a.data,encoding="utf-8"):
  case=json.loads(line);messages=[{"role":"system","content":SYSTEM},{"role":"user","content":case["question"]}];inputs=tok.apply_chat_template(messages,return_tensors="pt",add_generation_prompt=True).to(model.device)
  with torch.inference_mode():output=model.generate(inputs,max_new_tokens=200,do_sample=False,pad_token_id=tok.eos_token_id)
  answer=tok.decode(output[0][inputs.shape[-1]:],skip_special_tokens=True);ok=all(re.search(re.escape(term),answer,re.I) for term in case["required"]);passed+=bool(ok);total+=1;print(json.dumps({"question":case["question"],"passed":bool(ok),"answer":answer}))
 print(json.dumps({"passed":passed,"total":total,"pass_rate":passed/total if total else 0}))
 if passed!=total:raise SystemExit(1)
if __name__=="__main__":main()
