# FYNQ AI 1.0 — financial-aid fine-tuning prototype

Open-weight base: Qwen2.5-1.5B-Instruct. LoRA adapters are FYNQ training artifacts; base weights remain governed by their license. **No training run has been executed yet.** This eight-example synthetic dataset is a pipeline smoke test, not adequate for production quality. Human-reviewed, award-year-versioned, source-backed examples and a much larger independent evaluation suite are required before public launch.

## Run on a GPU machine

```bash
cd fynq-ai
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python train.py --epochs 3
python evaluate.py
export FYNQ_INFERENCE_KEY='set-a-long-random-secret-in-your-host'
uvicorn serve:app --host 0.0.0.0 --port 8000
```

Use POST /v1/financial-aid with Authorization: Bearer <secret> and JSON {"question":"What is SAI?"}. Keep the GPU server private behind FYNQ's gateway, with TLS, limits, logs and developer key management. Never commit secrets, personal financial-aid records or trained artifacts. Review model license and training data permissions. Pin and lock dependency versions before production deployment.

## Evaluation gate

`evaluate.py` fails if any of four simple expected-term checks fail. This is only a smoke test, not evidence of factual accuracy, safety, or superior performance. Add citations, current federal references, adversarial tests, numeric tests, privacy tests, and human evaluation before release.
