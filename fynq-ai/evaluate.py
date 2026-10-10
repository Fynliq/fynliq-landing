"""FYNQ AI evaluation: runs the held-out cases in data/eval.jsonl against a
model and applies the release gate (see grading.py).

Backends:
  local      the fine-tuned adapter on a GPU machine (or --adapter none for the base model)
               python evaluate.py --backend local --adapter artifacts/fynq-ai-1-lora
  openai     the current production fallback, the baseline FYNQ AI must beat
               OPENAI_API_KEY=... python evaluate.py --backend openai --model <FYNQ_FALLBACK_MODEL>
  answers    grade answers produced elsewhere: a JSONL of {"id", "answer"}
               python evaluate.py --backend answers --answers answers.jsonl
  reference  grade each case's own reference answer (a sanity check of the suite)

Every backend writes one line per case to --out (default reports/<backend>.jsonl),
a summary next to it, and prints the summary. Exit code 1 if the release gate fails.
Questions contain no personal data; the OpenAI backend sends them with store:false.
"""
import argparse
import json
import os
import sys
import time
import urllib.request

from grading import grade, load_cases, summarize
from prompt import SYSTEM


def local_backend(args):
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    tok = AutoTokenizer.from_pretrained(args.base)
    model = AutoModelForCausalLM.from_pretrained(args.base, device_map="auto", torch_dtype="auto")
    if args.adapter and args.adapter != "none":
        from peft import PeftModel

        model = PeftModel.from_pretrained(model, args.adapter)
    model.eval()

    def answer(question):
        messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": question}]
        inputs = tok.apply_chat_template(messages, return_tensors="pt", add_generation_prompt=True).to(model.device)
        with torch.inference_mode():
            out = model.generate(inputs, max_new_tokens=args.max_tokens, do_sample=False, pad_token_id=tok.eos_token_id)
        return tok.decode(out[0][inputs.shape[-1]:], skip_special_tokens=True)

    return answer


def openai_backend(args):
    key = os.environ.get("OPENAI_API_KEY", "")
    if not key or not args.model:
        sys.exit("Set OPENAI_API_KEY and pass --model (the FYNQ_FALLBACK_MODEL used in production).")

    def answer(question):
        body = json.dumps({"model": args.model, "store": False, "instructions": SYSTEM, "input": question, "max_output_tokens": args.max_tokens}).encode()
        for attempt in range(3):
            req = urllib.request.Request("https://api.openai.com/v1/responses", data=body, headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    data = json.load(r)
                return "".join(c.get("text", "") for o in data.get("output", []) if o.get("type") == "message" for c in o.get("content", []) if c.get("type") == "output_text")
            except Exception as e:  # noqa: BLE001 - retry transient provider errors
                if attempt == 2:
                    return f"[provider error: {type(e).__name__}]"
                time.sleep(2 * (attempt + 1))

    return answer


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--backend", choices=["local", "openai", "answers", "reference"], default="local")
    p.add_argument("--data", default="data/eval.jsonl")
    p.add_argument("--base", default="Qwen/Qwen2.5-1.5B-Instruct")
    p.add_argument("--adapter", default="artifacts/fynq-ai-1-lora")
    p.add_argument("--model", default=os.environ.get("FYNQ_FALLBACK_MODEL", ""))
    p.add_argument("--answers")
    p.add_argument("--max-tokens", type=int, default=400)
    p.add_argument("--out")
    a = p.parse_args()

    cases = load_cases(a.data)
    if a.backend == "reference":
        ask = lambda case: case["reference_answer"]  # noqa: E731
    elif a.backend == "answers":
        if not a.answers:
            sys.exit("--answers is required")
        with open(a.answers, encoding="utf-8") as f:
            given = {r["id"]: r["answer"] for r in (json.loads(line) for line in f if line.strip())}
        ask = lambda case: given.get(case["id"], "")  # noqa: E731
    else:
        fn = local_backend(a) if a.backend == "local" else openai_backend(a)
        ask = lambda case: fn(case["question"])  # noqa: E731

    out = a.out or f"reports/{a.backend}.jsonl"
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    results = []
    with open(out, "w", encoding="utf-8") as f:
        for case in cases:
            ans = ask(case)
            g = grade(ans, case)
            results.append((case, g))
            f.write(json.dumps({"id": case["id"], "topic": case["topic"], "kind": case["kind"], **g, "answer": ans}, ensure_ascii=False) + "\n")
    report, ok = summarize(results)
    with open(out[: -len(".jsonl")] + ".summary.json" if out.endswith(".jsonl") else out + ".summary.json", "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    print(json.dumps(report["gate"], indent=2))
    o = report["rates"]["overall"]
    print(("GATE PASSED" if ok else "GATE FAILED") + f": {o['passed']}/{o['total']} cases passed, {report['leaks']} leaks; details in {out}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
