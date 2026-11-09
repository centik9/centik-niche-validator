# Centik Niche Validator

In-house local niche check for one keyword in one explicitly named city. It reads Google Ads search demand and a capped Google Maps sample through DataForSEO, then applies a published heuristic. The index is not a grade, not a recommendation, and not an economic valuation.

Version 0.1.0 is safe to run with no credentials. Live DataForSEO calls are off unless the server process is started with `DATAFORSEO_LIVE=true`.

## Example decision flow

The page is a four-step example. It does not call Census, USDA, NOAA, or DataForSEO.

1. Type a service keyword only. City, state, and country are not collected. After a short pause, plumbing keywords show 20 sub-niches. Each priced row has a national published job-price range, with the source name, URL, and access date. Demand and competition stay example fixtures. One composite, from demand 40%, competition 30% (fewer competitors score higher), and margin 30%, sorts the rows green, then yellow, then red. A sub-niche with no published range says "Price range missing" and its composite is withheld. Any other keyword stays a single unranked label.
2. Choosing a sub-niche loads a fixed United States example shortlist. It is not filtered by a starting city, and it is not exhaustive national coverage. Cards use a fixture demand bar. The searches/competitors line is `example relative demand × 12` and `max(3, round(28 − demand / 4))`. Those figures are not Census housing and not keyword volume. Expand a card for sample housing, soil, and drought proxies, or for a missing-coverage note. The top card is not selected for you.
3. Choose a location. The sketch puts one 0–100 gauge at the top, then the demand, competition, and margin breakdown. The gauge is red below 30, yellow from 30 up to but not including 60, and green at 60 or higher. The yes/no gate states whether the composite clears green. The sketch also proposes a name, four pages, a headline, and a `.example` domain. Availability is not checked. Yes only stores a prototype choice. It does not create a site, buy a domain, or authorize spending.
4. After yes, the paid check stays off. Cities in the example gazetteer can run the existing example deep check and its combined heuristic index. Counties, metros, and cities outside that gazetteer do not receive an invented score.

## Free pre-screen

`POST /api/screen` ranks a short list of 1 to 20 US cities, counties, and metros before any DataForSEO call. The screen model is `centik-free-screen-v1`. It is not the paid heuristic index, not a probability, and not a revenue prediction.

`mode` is `sample` or `free`. `sample` uses a frozen short list in `data/screen-sample.json` and does not use the network. `free` reads the bundled 2023 ACS 5-year extract in `data/acs-2023-5yr-extract.json` and, for counties only, queries USDA Soil Data Access and NOAA Climate at a Glance. Neither mode calls DataForSEO.

Census figures are summary level 050 (county), 160 (place), and 310 (metro/micro) from the public table-based summary files, named with the 2024 Census Gazetteer. The Census Data API required a key when this was built, and this server has no key, so there is no live Census API call. Nine 2023 GEOIDs without a 2024 Gazetteer name were omitted. Place, county, and metro estimates are ranked only inside their own type.

Housing units, owner occupancy, and the share of units built in 1979 or earlier are positions inside the submitted group. Median income is shown with weight 0. A missing estimate is not scored as zero.

Soil is the share of rated SSURGO component acres whose highest representative linear extensibility in the top meter is at least 6 percent. Drought is the latest December Palmer Drought Severity Index in the 2023-2024 county series, transformed as `round(50 - 10 x PDSI)`. Freeze-thaw cycle counts are unavailable, not zero. Soil and drought apply only to counties, and only when the niche matches the foundation profile (`foundation`, `waterproofing`, `crawl space`, `pier and beam`, `slab leak`, `expansive soil`, `settlement`, `french drain`, `sump pump`, and the related phrases in `src/niche-profile.js`). Other niches keep those signals visible with weight 0.

A matched city can be copied into the deep-check form. A county or metro cannot. Sending `geography_type` of `county` or `metro` to `/api/resolve` or `/api/validate` returns 400 and does not call DataForSEO. The copy step does not resolve a location and does not start a paid check. Census place names and DataForSEO city names are different directories, so the deep check still has to resolve the city.

Rebuild the ACS extract with `node scripts/build-acs-extract.mjs`. That download is large and is not part of `npm test`.

## What a result is

A validation report has three separate pieces:

- **Demand.** Approximate average monthly Google searches for one keyword, from Google Ads via DataForSEO `POST /v3/keywords_data/google_ads/search_volume/live`. CPC, top-of-page bids, and paid-search competition are shown beside it and are not part of the index.
- **Maps sample.** Deduplicated organic listings from `POST /v3/serp/google/maps/live/advanced` with `depth` fixed at 20. Paid items and directory items are counted separately and excluded from the organic sample.
- **Heuristic index.** A weighted combination of a demand band and how full that 20-listing sample was. The formula, weights, inputs, completeness, and confidence adjustments are in every response. The combined index is withheld when it would have to be invented.

`market_measurement.exhaustive_market`, `buyers_verified`, and `economic_value_estimated` are always `false`.

## What this version does not do

- It does not estimate revenue, customer counts, close rates, advertiser spend, or market size in dollars. CPC is not multiplied by search volume.
- It does not treat a null from Google Ads as zero. Null, unsupported, and failed demand produce no combined index.
- It does not treat an empty Maps sample as an open market. A measured zero listing count withholds the combined index. The demand index is still reported.
- It does not claim the Maps sample is exhaustive. DataForSEO's endpoint defaults to 100 results and allows 700, billed per SERP of up to 100 results, with possible extra charges above 100. This app requests 20 and does not paginate.
- It does not treat `se_results_count` as a census. DataForSEO documents it as the SERP total, and published examples can show `0` while items are present. It is never used in the score.
- It does not treat `is_claimed` as a verified buyer. It means the Google listing has a claimed owner.
- It does not pick a city by a partial or wrong-state name. `Springfield` in Illinois is not Springfield in Missouri. `Portland` in Maine is not Portland in Oregon, and it is not South Portland.
- It does not send a Google Ads location code to the Maps endpoint, or the reverse. The two products have separate location lists.
- Example mode does not measure the city you typed. The banner says so. Fixture niches such as `missing volume` are exact phrases for the built-in fixture only. Live mode sends the keyword as typed.

## Run locally

Node.js 18 or newer. There are no npm dependencies.

```bash
npm test
npm start
```

The process binds `0.0.0.0` and listens on `PORT`, or 3000 if `PORT` is unset. Open `http://127.0.0.1:3000`.

`GET /health` returns the service name, version, whether live mode is exactly enabled, and whether both credential variables are non-empty. It does not return credential values.

## Web UI

The form asks for a niche keyword plus city, state, and country as separate fields. Resolve a location, confirm that the returned city is the one you meant, then run a validation.

The primary actions use example mode. Live buttons stay disabled unless `/health` reports `live_mode: true`, and the server still rejects a live request unless it was started with the opt-in below. A withheld index is labeled **Withheld**. It is not displayed as 0. A calculated `0.0` is a real result of the formula (measured zero demand and a full 20-listing sample).

## HTTP API

`POST /api/resolve` and `POST /api/validate` accept `application/json`.

Resolve:

```json
{
  "mode": "example",
  "city": "Austin",
  "state": "Texas",
  "country": "United States"
}
```

`mode` may be omitted and then defaults to `example`. `TX` is accepted for a US state. `CA` in the country field means Canada, not California. `England` is rejected as a country; put it in the state field and use United Kingdom or `gb` as the country. Two-letter codes that are US state abbreviations are not accepted as country codes, except the explicit country aliases (`US`, `CA`). Other ISO codes such as `fr` are accepted. Named countries include United States, Canada, United Kingdom, Australia, Germany, France, and the list in `src/countries.js`.

A usable resolve outcome is `matched`, `partial_match`, or `partial_failure`. `ambiguous`, `unconfirmed`, and `unsupported` cannot be validated. Same-city rows in another state are returned in `same_city_other_regions` and are not selected. A City or Municipality row is used only when its name segments match and a parent admin region (state, province, territory, and the other types listed in `src/locations.js`) confirms that state. Counties are not treated as the city. If the parent chain does not confirm the state, the outcome is `unconfirmed` and no billable request is sent.

Validate echoes the resolved identity. Client-supplied `location_code` fields outside that confirmed identity are ignored. A stale code returns 409 and does not call search volume or Maps.

```json
{
  "mode": "example",
  "niche": "emergency plumber",
  "city": "Austin",
  "state": "TX",
  "country": "United States",
  "confirmed": {
    "google_ads": {
      "location_code": 9001007,
      "location_name": "Austin,Texas,United States",
      "location_type": "City"
    },
    "google_maps": {
      "location_code": 9101007,
      "location_name": "Austin,Texas,United States",
      "location_type": "City"
    }
  }
}
```

The numeric codes above are example-gazetteer codes, not DataForSEO codes. Live mode replaces them with codes from the provider's location lists.

Field statuses are `measured`, `measured_zero`, `missing`, `unsupported`, `failed`, `unusable`, `inconsistent`, or `not_requested`. `measured_zero` means the provider returned a numeric zero. `missing` means the field was null or absent after a successful call. Those are not interchangeable.

## Environment

Copy the names from `.env.example`. Put real values in the host environment, not in git.

| Variable | Role |
| --- | --- |
| `DATAFORSEO_LOGIN` | DataForSEO API login. Required only when live mode is on. Never put the real value in git or in a client file. |
| `DATAFORSEO_PASSWORD` | DataForSEO API password. Same rule as the login. |
| `DATAFORSEO_LIVE` | Must be the exact string `true` to allow live calls. `TRUE`, `1`, and `yes` leave live mode off. |
| `SPEND_CAP_USD` | Total cap for paid calls since go-live, in USD. Default `10`. |
| `DATAFORSEO_SPENT_BASELINE_USD` | DataForSEO `money.total_spent` at go-live. Set once. The check is current `GET /v3/appendix/user_data` total minus this baseline, plus the quote. If this is missing, or that free call fails, live runs are refused. |
| `SPEND_LEDGER_PATH` | JSON ledger of paid calls. Default `./data/spend-ledger.json`. Each row stores the timestamp, user, niche, market, calls, and the cost DataForSEO returned. |
| `SPEND_TOKEN_SECRET` | HMAC key for the one-time spend token. There is no default. |
| `ALLOWED_EMAILS` | Comma-separated emails that may sign in. Default `team@centik.ai`. |
| `TEAM_ACCESS_CODE_HASH` | scrypt hash of the access code. Generate it with `node scripts/hash-access-code.mjs`. The plain code is not stored. |
| `SESSION_SECRET` | HMAC key for the session cookie. There is no default. |
| `PORT` | Optional listen port. Defaults to 3000. Render sets this. The process binds `0.0.0.0`. |

There is no `.env` loader. A file named `.env` is gitignored so it is not committed; this process does not read it. Inject the variables in the shell or the host.

Live calls use HTTP Basic auth and are not retried. The transport refuses any endpoint other than the two uncharged location lists, the search-volume live call, and the Maps live call. It refuses `location_name`, `location_coordinate`, custom date ranges, more than one keyword, `search_partners: true`, and any Maps depth other than 20 (example) or 100 (live). Request bodies that contain the login or password are refused before send. Logs and error responses pass through a redactor for those values and for `Authorization: Basic` tokens.

Location lists are cached in process memory for six hours. The cache is lost on restart. Those GET requests are not charged and are not written to the spend ledger.

A live check is about $0.09 for Google Ads search volume plus $0.002 for Maps, $0.092 together. Those two rates are `ADS_COST_USD` and `MAPS_COST_USD` in `src/spend.js`. Nothing is sent until a signed-in person gets a quote from `POST /api/quote` and sends that one-time token to `POST /api/validate`. The token is HMAC-signed with `SPEND_TOKEN_SECRET`, bound to the user and the normalized niche, city, state, country, and location codes, and it expires in 5 minutes. A used token is remembered in memory. The same niche and market is served from a 24-hour result cache and is not paid again. The ledger adds the task cost DataForSEO returns. `GET /api/spend` returns the totals and requires the session.

Live competition does not use `max(3, round(28 − demand / 4))`. The live index is `round(0.5 × listing room + 0.3 × share with no website + 0.2 × (100 − review pressure))`. Listing room is `round(100 × (30 − min(unique organic listings, 30)) / 30)`. The no-website share is that count divided by the deduped organic count. Review pressure is the average `votes_count` in the sample, capped at 100.

## Team access

`GET /health` is open. `/login` and `/logout` are open so a person can sign in and clear the cookie. Every other page and `/api` route requires a session. The sign-in page asks for an email and an access code. The email must be in `ALLOWED_EMAILS`. The code is checked with scrypt against `TEAM_ACCESS_CODE_HASH`, so the plain code is never in the repo or the environment. A match sets an HttpOnly, Secure, SameSite=Lax cookie named `centik_session`, signed with `SESSION_SECRET`, for 12 hours. Login attempts are limited to 8 per 15 minutes per IP. The access code and the DataForSEO credentials are not in the client files.

## How demand and Maps are read

Search volume requests send one keyword, `language_code` `en`, `search_partners` `false`, and the confirmed Google Ads city `location_code`. No date range is sent. DataForSEO's default is the past 12 months, and Google Ads does not return the current month. The report shows that request policy and the months actually present. The demand index uses the `search_volume` field, which DataForSEO describes as the approximate monthly average. A separate arithmetic mean of the monthly rows is only a cross-check.

`competition` values `LOW`, `MEDIUM`, and `HIGH`, and `competition_index` 0–100, are Google Ads paid-SERP advertiser competition. They are not local business counts.

CPC and the low/high top-of-page bids are Google Ads USD statistics. They are excluded from the index.

Maps requests send the same keyword, `language_code` `en`, the confirmed Maps `location_code`, `depth` 20, `device` `desktop`, `os` `windows`, and `search_this_area` `true`. `search_this_area: false` can pull listings from outside the displayed area, so it is not used.

Organic `maps_search` rows are deduplicated by `place_id`, then `cid`, then normalized title plus address. `maps_paid_item` rows and `is_directory_item: true` rows are excluded from the organic count. Listings whose `address_info.city` differs from the query city stay in the sample and are counted; they are not silently dropped. DataForSEO documents `address_info.region` as a DMA region, so it is not used as a state filter.

Requests use English. Searches in other languages are not measured. Google Ads may return no data for some keywords, may combine similar keywords, and may spell-correct. A differing `spell` value is reported, lowers confidence by 0.05, and means the volume describes the corrected keyword.

## Scoring model `centik-heuristic-v1`

Weights: demand index `0.65`, sample openness `0.35`. The implementation uses integer percents `65` and `35`.

Demand index, from approximate average monthly searches:

| Searches | Index | Label |
| --- | ---: | --- |
| 0 | 0 | Measured zero |
| 1–9 | 15 | Very low monthly average |
| 10–49 | 35 | Low monthly average |
| 50–199 | 55 | Moderate monthly average |
| 200–999 | 75 | High monthly average |
| 1000 and above | 90 | Very high monthly average |

The top band is 90 so a large volume is not shown as 100. Non-integers are `unusable` and are not placed in a band.

Sample openness:

```text
100 - (100 * min(unique_organic_listings, 20) / 20)
```

Combined index, only when both inputs are measured numbers and the unique organic count is greater than zero:

```text
round_half_up((65 * demand_index + 35 * sample_openness) / 10) / 10
```

Rounding uses that integer expression so binary floating point does not choose the tenth. The default example fixture (320 searches, 12 unique listings, openness 40) is `62.8`.

The combined index is withheld when:

- demand is missing, unsupported, failed, or unusable
- the Maps organic sample is missing, unsupported, or failed
- the Maps sample is a measured zero (openness would otherwise be 100)

Measured zero demand is still a measurement. It can enter the index when the Maps sample is a non-zero measured count.

Measured zero demand with a non-empty measured sample still produces an index. The demand index is 0, so the result only reflects unfilled slots in a 20-listing sample. The default example niche `zero volume` is `14.0`. The niche `zero volume saturated` is a calculated `0.0`, which is different from a withheld index.

Completeness is how many of the two required inputs were measured. CPC is not required.

Confidence is reported in hundredths only when the combined index is calculated. It starts at 35. It adds 15 when at least six monthly values are numeric, plus 5 more when at least twelve are numeric, plus 10 when both locations are City or Municipality. It subtracts 10 when the organic sample fills the depth cap, and 5 when the keyword was spell-corrected. The result is clamped between 20 and 75 hundredths. The cap is 0.75 because this is one English keyword and a 20-row Maps sample. It is not a probability that a niche will succeed. Confidence is withheld together with the index so missing demand cannot look confident.

The worked example for a normal keyword in example mode uses confidence `0.65`.

## Example fixtures

These niches are exact, case-insensitive matches in example mode only:

| Niche | What the fixture demonstrates |
| --- | --- |
| any other phrase | 320 average monthly searches, CPC 8.5 USD, 12 listings, one address city outside the query, `se_results_count` 0 alongside items, index 62.8 |
| `missing volume` | null volume and CPC; combined index withheld |
| `zero volume` | measured zero volume and CPC; index 14.0 |
| `zero volume saturated` | measured zero volume and 20 listings; calculated 0.0 |
| `missing cpc` | volume present, CPC null; index still 62.8 |
| `maps empty` | measured zero listings; index withheld |
| `maps duplicates` | duplicate `place_id` and title/address, plus paid and directory rows |
| `maps failed` / `maps timeout` / `demand failed` | component failure, not a zero |
| `spellcheck test` | spell value `emergency plumber`; confidence 0.60 |
| `uneven months` | monthly mean differs from `search_volume`; the index still uses `search_volume` |

Example location coverage is a small gazetteer: several Springfields, both Portlands, South Portland, Austin, New York City versus New York State, both Kansas Cities, Vancouver in Washington and in British Columbia, Washington DC versus Washington State, and Saint Louis. It is not the DataForSEO directory.

## Safety limits

- API body cap 8 KB, with a 10 second body timeout.
- Per-IP cap of 30 API requests per minute.
- When live mode is on, 4 live requests per 10 minutes per IP and 6 live requests per minute for the whole process. The Google Ads live endpoint's documented account limit is 12 requests per minute; the process cap stays under that.
- Upstream timeout 15 seconds. Responses over 25 MB are aborted.
- The HTTP server request timeout is 60 seconds.
- Rate-limit responses are 429 and do not send another provider request.
- `POST` with `mode: "live"` while the server flag is off returns 403. Example data is not substituted for that request.
- Live mode with the flag on but without both credentials returns 503 and does not call the network.

## Tests

`npm test` runs `node --test`. The suite uses an injected transport. It does not call DataForSEO.

## Render

`render.yaml` defines one Node web service, plan `free`.

- Build command: `npm ci`
- Start command: `node src/server.js`
- Health check: `GET /health`
- Bind is `0.0.0.0:$PORT`. Render sets `PORT`.
- These keys are `sync: false` and have no value in the file: `DATAFORSEO_LIVE`, `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`, `SPEND_CAP_USD`, `SPEND_TOKEN_SECRET`, `SESSION_SECRET`, `TEAM_ACCESS_CODE_HASH`, `ALLOWED_EMAILS`. Set them in the Dashboard. Do not commit them.
- The free plan's disk is ephemeral, so `./data/spend-ledger.json` resets on redeploy or restart. The cap still applies for the life of that instance. A starter plan with a persistent disk is worth it once the ledger has to survive a deploy. Until then the free plan is enough.

## One cheap live check

Do this once, after the secrets are set, and not from a test:

1. Set `DATAFORSEO_LIVE=true`, `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`, `SPEND_TOKEN_SECRET`, `SESSION_SECRET`, and `TEAM_ACCESS_CODE_HASH`. Leave `SPEND_CAP_USD` at 10.
2. Sign in at `/login`.
3. Open one keyword in one city and press the paid-check button once.
4. Expect one Google Ads call and one Maps call at depth 20. `GET /api/spend` should show the provider task costs, about $0.092 if DataForSEO bills the list prices.
5. Run that same keyword and city again within 24 hours. The cache should answer it and the spend total should stay the same.

Location-list lookups are free and cached. They are not part of the $0.092.

## Pending

A live call against DataForSEO was not made in this repository. Tests use mocks and the example fixtures. Deployment is left to the operator.

No license is included.
