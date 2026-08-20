"""
Converts the trained LSTM (bp_lstm_model_v2.keras) into TensorFlow Lite
format for offline, on-device inference — no internet or full TensorFlow
runtime required at prediction time.

Run this locally (in your care/ project folder):
    python convert_to_tflite.py
"""
import tensorflow as tf
from pathlib import Path

MODEL_PATH = Path(__file__).parent / "models" / "bp_lstm_model_v3.keras"
TFLITE_OUT = Path(__file__).parent / "models" / "bp_lstm_model_v3.tflite"

def convert():
    print(f"Loading model from {MODEL_PATH} ...")
    model = tf.keras.models.load_model(MODEL_PATH)

    converter = tf.lite.TFLiteConverter.from_keras_model(model)

    # Enable both built-in TFLite ops and (as fallback) TF ops, since some
    # LSTM internals aren't fully covered by the lightweight TFLite op set.
    converter.target_spec.supported_ops = [
        tf.lite.OpsSet.TFLITE_BUILTINS,
        tf.lite.OpsSet.SELECT_TF_OPS,
    ]

    # Optimize for size/speed on-device (quantization-friendly default).
    converter.optimizations = [tf.lite.Optimize.DEFAULT]

    print("Converting to TFLite format (this can take a minute)...")
    tflite_model = converter.convert()

    TFLITE_OUT.parent.mkdir(exist_ok=True)
    TFLITE_OUT.write_bytes(tflite_model)

    original_size = MODEL_PATH.stat().st_size / 1024
    tflite_size = TFLITE_OUT.stat().st_size / 1024
    print(f"\nDone. Saved to {TFLITE_OUT}")
    print(f"Original .keras size: {original_size:.1f} KB")
    print(f"TFLite size: {tflite_size:.1f} KB")

if __name__ == "__main__":
    convert()