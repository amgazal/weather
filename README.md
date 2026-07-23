# Layer — Weather You Can Wear

Layer is a Cornell campus-focused weather application that converts forecast data into personalized comfort and clothing recommendations.

## Live scenic backgrounds

The background is selected from Open-Meteo's **current live weather code** each time weather is loaded or refreshed:

- `0–2` — clear or partly cloudy → `public/backgrounds/clear.webp`
- `3`, `45`, `48` — overcast or fog → `public/backgrounds/cloudy.webp`
- `51–67`, `80–82`, `95–99` — drizzle, rain, showers, or thunderstorm → `public/backgrounds/rain.webp`
- `71–77`, `85–86` — snow or snow showers → `public/backgrounds/snow.webp`

The outing planner still changes the clothing recommendation for a future departure, but it does not overwrite the live background. This keeps the page visually grounded in what is happening on campus now.

The scene files are preloaded and use `import.meta.env.BASE_URL`, so they work both locally and at `https://amgazal.github.io/weather/`.

## Run locally

```bash
npm install
npm run dev
```

## Deploy

Push the complete project to the `main` branch. The included GitHub Actions workflow builds and deploys the Vite app to GitHub Pages. In **Settings → Pages**, keep the source set to **GitHub Actions**.


## White-screen fix

This version adds explicit loading guards before rendering weather-dependent values. It prevents the initial React render from reading `result.personalShift` before the weather calculation exists.


## Mobile-first hierarchy

On screens below 980px, the interface now renders in this order:

1. Live weather summary and personalized temperature
2. Clothing recommendation
3. Activity selection
4. Future-outing planner
5. Comfort threats, feedback, and calibration

This prevents the clothing/activity cards from appearing above the main weather information on phones.
