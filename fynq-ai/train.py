import argparse, json, os
from datasets import Dataset
from transformers import AutoTokenizer, AutoModelForCausalLM, TrainingArguments
from peft import LoraConfig
from trl import SFTTrainer

SYSTEM = "You are FYNQ AI, a specialist in US financial aid. Explain FAFSA, Pell, grants, loans, SAI, school aid offers and refunds accurately. Do not invent eligibility, amounts or deadlines. Protect sensitive information and advise users to verify with StudentAid.gov and their school's aid office."
def load_examples(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]
def main():
    p=argparse.ArgumentParser()
    p.add_argument("--model",default="Qwen/Qwen2.5-1.5B-Instruct")
    p.add_argument("--data",default="data/train.jsonl")
    p.add_argument("--output",default="artifacts/fynq-ai-1-lora")
    p.add_argument("--epochs",type=int,default=3)
    args=p.parse_args()
    tokenizer=AutoTokenizer.from_pretrained(args.model,trust_remote_code=False)
    examples=load_examples(args.data)
    texts=[tokenizer.apply_chat_template([{"role":"system","content":SYSTEM},{"role":"user","content":x["question"]},{"role":"assistant","content":x["answer"]}],tokenize=False) for x in examples]
    dataset=Dataset.from_dict({"text":texts})
    model=AutoModelForCausalLM.from_pretrained(args.model,torch_dtype="auto",device_map="auto",trust_remote_code=False)
    cfg=LoraConfig(r=16,lora_alpha=32,lora_dropout=0.05,bias="none",task_type="CAUSAL_LM",target_modules=["q_proj","k_proj","v_proj","o_proj"])
    training=TrainingArguments(output_dir=args.output,num_train_epochs=args.epochs,per_device_train_batch_size=1,gradient_accumulation_steps=4,learning_rate=1e-4,logging_steps=1,save_strategy="epoch",report_to="none",gradient_checkpointing=True)
    trainer=SFTTrainer(model=model,args=training,train_dataset=dataset,peft_config=cfg,processing_class=tokenizer)
    trainer.train()
    trainer.model.save_pretrained(args.output)
    tokenizer.save_pretrained(args.output)
    print("Saved FYNQ AI adapter to",args.output)
if __name__=="__main__":main()
