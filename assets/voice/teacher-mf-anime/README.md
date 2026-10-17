# Teacher voice: Irodori MF / Anime reference → Fish Audio

The user-approved reference is `reference.wav` (21.44 seconds), with its exact
transcript in `transcript.txt` and SHA-256 in `manifest.json`. Keep these files;
the comparison output folder is not a production dependency.

Production synthesis remains **Fish Audio `s2.1-pro-free`**. Irodori MF produced
the reference offline; it does not run on Cloudflare. Fish uses this reference
for voice conditioning, without training a new synthesis model.

The reference was registered using POST /model, multipart `voices` + `texts`,
`type=tts`, `train_mode=fast`, `visibility=private`,
`enhance_audio_quality=false`, `generate_sample=false`. Its ID is recorded in
manifest.json and configured through the GitHub `FISH_VOICE_ID` secret.
`FISH_API_KEY` must belong to the account owning this private voice.

The approved preview used raw reference bytes and `latency=normal`. Production
uses the saved equivalent reference ID, normal latency, and timestamped Opus
48 kHz for lecture synchronization. Preview WAV was 44.1 kHz. Generation is
stochastic: these settings do not guarantee identical waveforms.

Changing the voice ID separates new speech-cache entries from the old stock
voice. Existing already-generated speech in a running lesson can remain old;
start a new lesson for the new voice.

Verification: registered voice successfully generated 8.42 seconds of audio
(63,338 bytes) with 23 timestamp segments in 4.87 seconds through the production
provider implementation. This is a direct Fish API check, not a full hosted
lesson acceptance test. Evidence is in `output/fish-production-reference/`.

Deployment: `.github/workflows/deploy-cloudflare.yml`, approved account
`2ea670c2a6ff28e248ef084adf095e8b`. Cloud runtime pins the free model and does
not switch to a paid model when generation fails.
