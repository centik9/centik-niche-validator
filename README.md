# Centik Niche Validator

In-house check for whether a city and niche are worth a microsite. It reads packed Google Ads search demand, a 100-listing Google Maps sample, a first page of regular Google results, and Google Trends seasonality through DataForSEO, then applies a published heuristic. Maps listing room stays the competition score. The index is not a grade, not a recommendation, and not an economic valuation.

Version 0.1.0 is safe to run with no credentials. Live DataForSEO calls are off unless the server process is started with `DATAFORSEO_LIVE=true`.

## Example decision flow

With live mode off, the page is a four-step example. It does not call Census, USDA, NOAA, or DataForSEO.

1. Type a service keyword only. City, state, and country are not collected. After a short pause, plumbing keywords show 20 example sub-niches. A trade keyword such as welding or HVAC shows the built-in eight-trade example list, with the matching trade first. Each priced row has a national published job-price range, with the source name, URL, and access date. Demand and competition stay example fixtures. One composite, from demand 40%, competition 30% (fewer competitors score higher), and margin 30%, sorts the rows green, then yellow, then red. A sub-niche with no published range says "Price range missing" and its composite is withheld. Any other keyword stays a single unranked label. The rows are labeled as example data.
2. Choosing a sub-niche loads a fixed United States example shortlist. It is not filtered by a starting city, and it is not exhaustive national coverage. Cards use a fixture demand bar. The searches/competitors line is `example relative demand × 12` and `max(3, round(28 − demand / 4))`. Those figures are not Census housing and not keyword volume. Expand a card for sample housing, soil, and drought proxies, or for a missing-coverage note. The top card is not selected for you.
3. Choose a location. The sketch puts one 0–100 gauge at the top, then the demand, competition, and margin breakdown. The gauge is red below 30, yellow from 30 up to but not including 60, and green at 60 or higher. The yes/no gate states whether the composite clears green. The sketch also proposes a name, four pages, a headline, and a `.example` domain. Availability is not checked. Yes only stores a prototype choice. It does not create a site, buy a domain, or authorize spending.
4. After yes, the paid check stays off. Cities in the example gazetteer can run the existing example deep check and its combined heuristic index. Counties, metros, and cities outside that gazetteer do not receive an invented score.

## Live Step 1 specialties

When `DATAFORSEO_LIVE=true` and both credentials are set, Step 1 does not use the example lists. Typing still does not call DataForSEO. Press Find specialties, read the price, then press Okay.

The lookup is one task:

`POST /v3/dataforseo_labs/google/keyword_ideas/live`

- One seed keyword, the normalized service the person typed.
- `location_code` `2840` (United States). Step 1 still has no city. The later paid check measures the city that gets picked.
- `language_code` `en`.
- `closely_variants` `true` (phrase match, not broad match).
- `limit` `40`.
- `include_serp_info` `false` and `include_clickstream_data` `false`. Clickstream data would double the price, so it is refused.
- Ordered by `keyword_info.search_volume,desc`.

DataForSEO Labs bills `$0.012` per task plus `$0.00012` per returned item. Forty items cost `$0.0168`. The spend ledger stores thousandths of a dollar, so the cap reserves `$0.017` (`KEYWORD_IDEAS_COST_USD`). The ledger stores the task cost DataForSEO returns when that number is present.

Ideas that name a different trade (plumbing on a welding search, electrician or locksmith on an HVAC search, and the same kind of cross-trade phrase) are removed. Word-order and welder/welding twins are clustered, and the list is ranked by United States search volume. If fewer than three in-trade ideas have a measured volume, the note says so. If none do, the list is empty. The eight-trade example catalog is not added and is not returned as if it were live.

A confirmed lookup is cached by normalized keyword and location code (`welding|2840|keyword-ideas-v1`). The same keyword, including different capitalization, is served from that cache at `$0` and does not call DataForSEO. The cache file defaults to `./data/subniche-cache.json`. A different keyword is a new confirmation. Nothing is sent without the one-time spend token, and a token from the city check cannot be reused here.

## Run history

Every completed check for the signed-in user is appended to a JSON file, the same kind of store as the result cache. The default path is `run-history.json` beside `RESULT_STORE_PATH`. Render's free disk does not survive sleep, so point `RUN_HISTORY_PATH` and `RESULT_STORE_PATH` at storage that does. A row stores the date, service, city, state, volume, map sample, competition, market score, and the zone chip (No, Low, Medium, High, or Max). That zone chip is the grade. There is no letter grade. The active lens is stored too. Credentials and spend tokens are not.

Runs group by service, city, state, map depth, and check version. A shallower map depth stays in its own group. It is not reused for a depth 100 check and it is not compared with one. History is a top-bar button and opens in the same enlarge overlay. A repeat of the same group can open a side-by-side compare. A moved number reads `up 6` or `down 6`. A range stays a range. If the lenses differ, the kinds of number differ, or a field is missing, the change reads `Not comparable`.

## Two lenses

Classroom floor and Jesse's four-yes test use the same inputs and return two verdicts. They are not averaged and they are not one badge. The sample water heater repair row can pass Classroom floor and fail the four-yes test on the same sample ticket. That tension stays visible.

Classroom floor follows the Microsite Empire notes: urgent one-off work people phone about, and a job value of at least $500. The $1,000 to $2,000 line is guidance, not a second hard fail. The lens fails only when a published job total is under $500. Non-urgent work is Caution. Emergency locksmith is the course example of the floor and a flagged niche, so both lenses show Hard stop and never Pass.

Jesse's four-yes test, in order: a ticket of $5,000 or more, about 1,500 operators in the state, a weak page one for "best [service] in [location]", and sponsored ads. The operator row is the directory test. It is shown and it does not by itself fail a microsite. Missing data is Not enough evidence, not a no. The market-score dial stays a separate Demand, Competition, and Margin score.

The lens verdict has to be on screen before Step 4 can be armed. Hard stop keeps Step 4 locked. You can still type a service and skip the shortlist.

## Discovery shortlist

`Generate shortlist` sits above the grid, labeled Before Step 1. It is free and it does not call DataForSEO. It ranks city and service pairs from the Nov 6 and Nov 10 research notes and, in free mode, from the bundled Census extract: owner-occupancy, population when a note has it, a population-edge label, a price-guide ticket, and Places or contractor-page checks. Housing age stays Not fetched. It is not in that method and it is not used to rank. There is no fit score. An unmeasured field says Not on file or Not fetched. The tool does not invent search volume, CPC, review counts, or ranks.

The worked example puts Bella Vista retaining walls first and keeps Lancaster septic visible as the fallback if that map pack is dense, then Grass Valley, Battle Ground, and Leland. Other pairs are ranked with the same rules when a measurement is on file. `Use this pair` fills the service and the city field only. The heat map stays the Austin and Cedar Park sample. The city field accepts any US city name. Paid DataForSEO stays behind the spend confirmation and the $10 cap.

## Free pre-screen

`POST /api/screen` ranks a short list of 1 to 20 US cities, counties, and metros before any DataForSEO call. The screen model is `centik-free-screen-v1`. It is not the paid heuristic index, not a probability, and not a revenue prediction.

`mode` is `sample` or `free`. `sample` uses a frozen short list in `data/screen-sample.json` and does not use the network. `free` reads the bundled 2023 ACS 5-year extract in `data/acs-2023-5yr-extract.json` and, for counties only, queries USDA Soil Data Access and NOAA Climate at a Glance. Neither mode calls DataForSEO.

Census figures are summary level 050 (county), 160 (place), and 310 (metro/micro) from the public table-based summary files, named with the 2024 Census Gazetteer. The Census Data API required a key when this was built, and this server has no key, so there is no live Census API call. Nine 2023 GEOIDs without a 2024 Gazetteer name were omitted. Place, county, and metro estimates are ranked only inside their own type.

Housing units, owner occupancy, and the share of units built in 1979 or earlier are positions inside the submitted group. Median income is shown with weight 0. A missing estimate is not scored as zero.

Soil is the share of rated SSURGO component acres whose highest representative linear extensibility in the top meter is at least 6 percent. Drought is the latest December Palmer Drought Severity Index in the 2023-2024 county series, transformed as `round(50 - 10 x PDSI)`. Freeze-thaw cycle counts are unavailable, not zero. Soil and drought apply only to counties, and only when the niche matches the foundation profile (`foundation`, `waterproofing`, `crawl space`, `pier and beam`, `slab leak`, `expansive soil`, `settlement`, `french drain`, `sump pump`, and the related phrases in `src/niche-profile.js`). Other niches keep those signals visible with weight 0.

A matched city can be copied into the deep-check form. A county or metro cannot. Sending `geography_type` of `county` or `metro` to `/api/resolve` or `/api/validate` returns 400 and does not call DataForSEO. The copy step does not resolve a location and does not start a paid check. Census place names and DataForSEO city names are different directories, so the deep check still has to resolve the city.

Rebuild the ACS extract with `node scripts/build-acs-extract.mjs`. That download is large and is not part of `npm test`.

## What a result is

A validation report has these separate pieces:

- **Demand.** Approximate average monthly Google searches for a small packed phrase list, from one Google Ads task via DataForSEO `POST /v3/keywords_data/google_ads/search_volume/live`. The demand index uses clustered coverage volume: one maximum from each word-order cluster, summed. The core term stays visible separately. CPC, top-of-page bids, and paid-search competition are shown beside each phrase and are not part of the index.
- **Maps sample.** Deduplicated organic listings from `POST /v3/serp/google/maps/live/advanced` with `depth` fixed at 100. Paid items and directory items are counted separately and excluded from the organic sample. This sample is the competition score.
- **Regular Google results.** First page only, `POST /v3/serp/google/organic/live/advanced` at depth 10. Directory share is a supporting signal and does not change the Maps competition score.
- **Seasonality.** Google Trends explore live, one keyword, past 12 months. Relative 0–100 interest only. It does not replace Ads volume and it does not penalize a seasonal niche.
- **Heuristic index.** A weighted combination of a demand band and how full that 100-listing sample was. The formula, weights, inputs, completeness, and confidence adjustments are in every response. The combined index is withheld when it would have to be invented.

`market_measurement.exhaustive_market`, `buyers_verified`, and `economic_value_estimated` are always `false`.

## What this version does not do

- It does not estimate revenue, customer counts, close rates, advertiser spend, or market size in dollars. CPC is not multiplied by search volume.
- It does not treat a null from Google Ads as zero. Null, unsupported, and failed demand produce no combined index.
- It does not treat an empty Maps sample as an open market. A measured zero listing count withholds the combined index. The demand index is still reported.
- It does not claim the Maps sample is exhaustive. DataForSEO bills one Maps SERP for up to 100 results. This app requests depth 100 and does not paginate past that.
- It does not replace the Maps competition score with regular Google results, and it does not turn Trends interest into search volume.
- It does not treat `se_results_count` as a census. DataForSEO documents it as the SERP total, and published examples can show `0` while items are present. It is never used in the score.
- It does not treat `is_claimed` as a verified buyer. It means the Google listing has a claimed owner.
- It does not pick a city by a partial or wrong-state name. `Springfield` in Illinois is not Springfield in Missouri or Massachusetts. `Portland` in Maine is not Portland in Oregon, and it is not South Portland. `Omaha` in Texas is not Omaha in Nebraska. `Bella Vista` in Arkansas is not Bella Vista in California. `Lancaster` in Ohio is not Lancaster in Pennsylvania or California. A city that cannot be confirmed in the chosen state is an error. Another state's row is not used.
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

The primary actions use example mode. Live buttons stay disabled unless `/health` reports `live_mode: true`, and the server still rejects a live request unless it was started with the opt-in below. Missing demand is labeled **Insufficient data**. It is not displayed as 0. A measured zero is labeled **0 (measured)**. If that measured zero would otherwise produce a favorable grade, the displayed grade is capped at **14.9**, a clear fail. A calculated `0.0` remains a real formula result when measured zero demand meets a full 100-listing sample.

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
| `DATAFORSEO_SPENT_BASELINE_USD` | Go-live account spend, set once. DataForSEO's free `GET /v3/appendix/user_data` has `money.total` and `money.balance`, not `money.total_spent`, so spend is `total − balance` unless `total_spent` is present. The production baseline is the derived value `1.17145`. The check is current spend minus this baseline, plus the quote. If this is missing, or that free call fails, or the fields are not finite numbers, live runs are refused. |
| `SPEND_LEDGER_PATH` | JSON ledger of paid calls. Default `./data/spend-ledger.json`. Each row stores the timestamp, user, niche, market, calls, and the cost DataForSEO returned. |
| `RESULT_STORE_PATH` | JSON file of scored map and search results. The server defaults to `./data/result-cache.json` when this is unset. A hit for the same niche, city, check version, and a map depth at least as deep as the current check is quoted at $0 and does not call DataForSEO. A shallower or older check version is not reused. Results stay until someone uses Rerun paid check. |
| `SUBNICHE_CACHE_PATH` | JSON file of Step 1 specialty lookups. Default `./data/subniche-cache.json`. A hit for the same normalized keyword and United States location is served at $0. |
| `RUN_HISTORY_PATH` | JSON file of completed checks for signed-in users. Default is `run-history.json` beside `RESULT_STORE_PATH`. Same disk caveat. |
| `SPEND_TOKEN_SECRET` | HMAC key for the one-time spend token. There is no default. |
| `ALLOWED_EMAILS` | Comma-separated emails that may sign in. Default `team@centik.ai`. |
| `TEAM_ACCESS_CODE_HASH` | scrypt hash of the access code. Generate it with `node scripts/hash-access-code.mjs`. The plain code is not stored. |
| `SESSION_SECRET` | HMAC key for the session cookie. There is no default. |
| `PORT` | Optional listen port. Defaults to 3000. Render sets this. The process binds `0.0.0.0`. |

There is no `.env` loader. A file named `.env` is gitignored so it is not committed; this process does not read it. Inject the variables in the shell or the host.

Live calls use HTTP Basic auth and are not retried. The transport allows the uncharged Ads, Maps, and Trends location lists, one packed search-volume live task, the Maps live call, one organic live call at depth 10, one Trends explore live task, and one keyword-ideas live task for Step 1. It refuses every other DataForSEO path, including related-keywords and keywords-for-keywords. It refuses `location_name`, `location_coordinate`, custom date ranges, `search_partners: true`, more than 20 volume keywords, any Maps depth other than 100, organic depth other than 10, organic search operators, `load_async_ai_overview`, `calculate_rectangles`, and `people_also_ask_click_depth`. Trends sends one keyword, `type` `web`, and `time_range` `past_12_months`. Keyword ideas send one seed, `language_code` `en`, location code `2840`, limit `40`, phrase match, and no clickstream or SERP add-on. Request bodies that contain the login or password are refused before send. Logs and error responses pass through a redactor for those values and for `Authorization: Basic` tokens.

Location lists are cached in process memory for six hours. The cache is lost on restart. Those GET requests are not charged and are not written to the spend ledger.

A live city check is $0.105: Google Ads search volume live $0.09, Maps live advanced depth 100 $0.002, Google organic live depth 10 $0.002, and Google Trends explore live $0.011. Those rates are `ADS_COST_USD`, `MAPS_COST_USD`, `ORGANIC_COST_USD`, and `TRENDS_COST_USD` in `src/spend.js`, and `QUERY_COST_USD` is 0.105. Step 1 specialty discovery is not part of that $0.105. It is a separate keyword-ideas confirmation at up to $0.017. Nothing is sent until a signed-in person gets a quote from `POST /api/quote` and sends that one-time token to `POST /api/validate`. The token is HMAC-signed with `SPEND_TOKEN_SECRET`, bound to the user and the normalized niche, city, state, country, location codes, and whether this confirmation is a rerun, and it expires in 5 minutes. A used token is remembered in memory. A saved result for the same niche and city is reused when its check version matches and its map depth is at least the current depth (100). The saved record stores the full scored report and the captured-at time. A depth-20 result, a volume-only result, or a different check version is not reused. A deeper saved result can satisfy the current check. There is no 24 hour expiry. Rerun paid check is the refresh: it asks for a new quote at $0.105, still requires Okay on the confirm card, and then replaces the saved result. The four paid calls run in parallel after confirm. The ledger adds the task cost DataForSEO returns. `GET /api/spend` returns the totals and requires the session.

Live competition does not use `max(3, round(28 − demand / 4))`. The live index is `round(0.5 × listing room + 0.3 × share with no website + 0.2 × (100 − review pressure))`. Listing room is `round(100 × (100 − min(unique organic listings, 100)) / 100)`, so 40 listings scores differently from 90. The no-website share is that count divided by the deduped organic count. Review pressure is the average `votes_count` in the sample, capped at 100.

## Team access

`GET /health` is open. `/login` and `/logout` are open so a person can sign in and clear the cookie. Every other page and `/api` route requires a session. The sign-in page asks for an email and an access code. The email must be in `ALLOWED_EMAILS`. The code is checked with scrypt against `TEAM_ACCESS_CODE_HASH`, so the plain code is never in the repo or the environment. A match sets an HttpOnly, Secure, SameSite=Lax cookie named `centik_session`, signed with `SESSION_SECRET`, for 12 hours. Login attempts are limited to 8 per 15 minutes per IP. The access code and the DataForSEO credentials are not in the client files.

## How demand and Maps are read

Search volume requests send one task with a short deterministic phrase list: the core niche, city word-order variants, “near me”, a simple plural, and a repair variant when the niche does not already say repair or service. `language_code` is `en`, `search_partners` is `false`, and the location is the confirmed Google Ads city `location_code`. No date range is sent. DataForSEO's default is the past 12 months, and Google Ads does not return the current month. Every returned phrase is kept, with its monthly volume, CPC, bids, and paid-search competition. The demand index uses clustered coverage volume, not the raw sum and not the core term alone. The core term remains `search_volume`. A separate arithmetic mean of the core term's monthly rows is only a cross-check.

`competition` values `LOW`, `MEDIUM`, and `HIGH`, and `competition_index` 0–100, are Google Ads paid-SERP advertiser competition. They are not local business counts.

CPC and the low/high top-of-page bids are Google Ads USD statistics. They are excluded from the index.

Maps requests send the same keyword, `language_code` `en`, the confirmed Maps `location_code`, `depth` 100, `device` `desktop`, `os` `windows`, and `search_this_area` `true`. Depth 100 is one billed Maps SERP, the same $0.002 as a 20-result call. `search_this_area: false` can pull listings from outside the displayed area, so it is not used.

Organic `maps_search` rows are deduplicated by `place_id`, then `cid`, then normalized title plus address. `maps_paid_item` rows and `is_directory_item: true` rows are excluded from the organic count. Listings whose `address_info.city` differs from the query city stay in the sample and are counted; they are not silently dropped. DataForSEO documents `address_info.region` as a DMA region, so it is not used as a state filter.

Requests use English. Searches in other languages are not measured. Google Ads may return no data for some keywords, may combine similar keywords, and may spell-correct. A differing `spell` value is reported, lowers confidence by 0.05, and means the volume describes the corrected keyword.

## Scoring model `centik-heuristic-v1`

Weights: demand index `0.65`, sample openness `0.35`. The implementation uses integer percents `65` and `35`.

Demand index, from clustered coverage volume (the sum of each cluster's maximum measured monthly searches, not the core term and not a raw sum of word-order twins):

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
100 - (100 * min(unique_organic_listings, 100) / 100)
```

Combined index, only when both inputs are measured numbers and the unique organic count is greater than zero:

```text
round_half_up((65 * demand_index + 35 * sample_openness) / 10) / 10
```

Rounding uses that integer expression so binary floating point does not choose the tenth. The default example fixture (320 searches, 12 unique listings, openness 88) is `79.6`.

The combined index is withheld when:

- demand is missing, unsupported, failed, or unusable
- the Maps organic sample is missing, unsupported, or failed
- the Maps sample is a measured zero (openness would otherwise be 100)

Measured zero demand is still a measurement. The demand index stays 0 when the Maps sample is a non-zero measured count. If the weighted formula would land at 15.0 or higher, the displayed grade is capped at 14.9 so a zero-demand market cannot look workable, green, or favorable. The uncapped formula result is kept on `grade_cap`. Missing, failed, empty, and unusable demand stay withheld as insufficient data and are not capped into a zero.

The default example niche `zero volume` has an uncapped formula result of `30.8` and a displayed grade of `14.9`. The niche `zero volume saturated` is a calculated `0.0`, which is different from insufficient data.

Completeness is how many of the two required inputs were measured. CPC is not required.

Confidence is reported in hundredths only when the combined index is calculated. It starts at 35. It adds 15 when at least six monthly values are numeric, plus 5 more when at least twelve are numeric, plus 10 when both locations are City or Municipality. It subtracts 10 when the organic sample fills the depth cap, and 5 when the keyword was spell-corrected. The result is clamped between 20 and 75 hundredths. The cap is 0.75 because this is one English keyword and a 100-row Maps sample. It is not a probability that a niche will succeed. Confidence is withheld together with the index so missing demand cannot look confident.

The worked example for a normal keyword in example mode uses confidence `0.65`.

## Example fixtures

These niches are exact, case-insensitive matches in example mode only:

| Niche | What the fixture demonstrates |
| --- | --- |
| any other phrase | 320 average monthly searches, CPC 8.5 USD, 12 listings, one address city outside the query, `se_results_count` 0 alongside items, index 79.6 |
| `missing volume` | null volume and CPC; combined index withheld |
| `zero volume` | measured zero volume and CPC; uncapped formula 30.8, displayed grade capped at 14.9 |
| `zero volume saturated` | measured zero volume and 100 listings; calculated 0.0 |
| `missing cpc` | volume present, CPC null; index still 79.6 |
| `maps empty` | measured zero listings; index withheld |
| `maps duplicates` | duplicate `place_id` and title/address, plus paid and directory rows |
| `maps failed` / `maps timeout` / `demand failed` | component failure, not a zero |
| `spellcheck test` | spell value `emergency plumber`; confidence 0.60 |
| `uneven months` | monthly mean differs from `search_volume`; the index still uses `search_volume` |

Example location coverage is a small gazetteer: several Springfields, both Portlands, South Portland, both Omahas, both Bella Vistas, three Lancasters, Austin, New York City versus New York State, both Kansas Cities, Vancouver in Washington and in British Columbia, Washington DC versus Washington State, and Saint Louis. It is not the DataForSEO directory.

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
- The free plan's disk is ephemeral, so `./data/spend-ledger.json`, `./data/result-cache.json`, `./data/run-history.json`, and `./data/subniche-cache.json` reset when the service sleeps, restarts, or redeploys. The cap still applies for the life of that instance. This repo does not add a Render Postgres or Key Value instance. The result store is the `load` / `find` / `save` interface in `src/result-store.js`. Run history uses the same kind of file store, in the same directory by default. The file store is what tests and a local preview use. For a production host that already has storage surviving restart, set `RESULT_STORE_PATH`, `RUN_HISTORY_PATH`, and `SUBNICHE_CACHE_PATH` to paths that survive restart, or pass a `resultStore` into `createSpendGate`. Do not buy a new database for this cache.

## One cheap live check

Do this once, after the secrets are set, and not from a test:

1. Set `DATAFORSEO_LIVE=true`, `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`, `SPEND_TOKEN_SECRET`, `SESSION_SECRET`, and `TEAM_ACCESS_CODE_HASH`. Leave `SPEND_CAP_USD` at 10.
2. Sign in at `/login`.
3. Open one keyword in one city and press the paid-check button once. Step 1 is separate: Find specialties, then Okay, sends one keyword-ideas task at up to $0.017 and caches that keyword for the United States. It does not run the four-call city check.
4. Expect four paid calls for the city check: Google Ads search volume, Maps at depth 100, organic at depth 10, and Google Trends explore. `GET /api/spend` should show the provider task costs, about $0.105 if DataForSEO bills the list prices. Maps depth 100 is still $0.002. Organic depth 10 is $0.002. Trends explore live is $0.011. A Step 1 row is the keyword-ideas endpoint, about $0.0168 before the ledger rounds it to $0.017.
5. Run that same keyword and city again. The saved result should answer it at $0, with the original captured-at time, and the spend total should stay the same. Rerun paid check is a new $0.105 confirmation. On the free Render disk that file is lost when the service sleeps.

Location-list lookups, including the Google Trends location list used to choose city, metro, state, or national, are free and cached. They are not part of the $0.105.

## Pending

A live call against DataForSEO was not made in this repository. Tests use mocks and the example fixtures. Deployment is left to the operator.

No license is included.
