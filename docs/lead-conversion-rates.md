# Lead conversion rates (Phase 1)

The estimates box can apply a seeded, per-niche conversion rate when we have one. Phase 1 only ships the seeded table, the resolver, and the user-facing label. On-demand research (Phase 2) and usage-triggered monthly refresh (Phase 3) are deferred.

## What the numbers are

The seeded rates come from the LocaliQ / WordStream 2025 Home Services Search Ads Benchmarks (3,211 US campaigns, Apr 1 2024-Mar 21 2025). The official table is on the [LocaliQ blog](https://localiq.com/blog/home-services-search-advertising-benchmarks/). There is a [companion PDF](https://www.wordstream.com/wp-content/uploads/2025/06/ws-guide-home-services-benchmarks-2025.pdf).

These figures are median ad click-to-lead CVRs: the share of search-ad clicks that become a lead or sale. They are not the share of all Google searches that become a lead, a call, or a booked job. Phase 1 still applies a mapped rate to monthly search volume so the box can show a niche-specific estimate, and the caption has to say what the rate actually measures.

Plumbing 7.63% is taken from the LocaliQ blog table. The PDF body only printed category highs and lows, not this mid-table value.

Google's 2014 (18%) and 2016 (28%) nearby-search purchase rates are older, market-wide local-search diaries. They are not niche-specific. They are context only and are not applied here.

## Applied seeded rates

| Category | Median CVR | Mapping notes |
| --- | --- | --- |
| Plumbing | 7.63% | Plumbing plus plumbing subniches (emergency plumbing, water heater repair, drain cleaning, and the rest of the fixture list). |
| HVAC | 7.02% | Midpoint of Air Conditioning Installation & Repair 6.56% and Heating & Furnaces 7.48%. |
| Electricians & Electrical Contractors | 9.08% | Electrician and electrical labels. |
| Cleaning / Maid / Butler Services | 17.65% | Cleaning labels only. Drain cleaning stays with plumbing. |
| Roofing & Gutters | 3.70% | Roofing and gutter labels. |
| Handyman Services | 13.45% | Handyman labels. |
| Paint & Painting | 10.80% | Painting labels. |
| Landscaping | 6.42% | Landscaping labels. |
| Window Cleaning | 13.58% | Window cleaning only, not doors and windows. |
| Pools & Spas | 10.89% | Pool and spa labels. |
| Doors & Windows Sales | 4.41% | Doors and windows sales, not window cleaning. |
| Construction & Contractors (General) | 2.61% | Construction / general contractor labels. |
| Blinds & Window Treatments | 6.00% | Blinds and window treatment labels. |
| Storage | 4.65% | Storage labels. |

LocaliQ "Garages" 5.66% is stored in the table and is not applied. It is not mapped to garage-door repair. The home services average 7.33% is stored and is not used as a catch-all.

## Niches without a studied rate

Locksmith, garage-door, mobile-welding, retaining-wall, crawl-space, and any unknown or custom niche stay in a looking-up state. The box shows leads as "-" and does not fall back to the old 38-52 leads from 2,900 searches default. That default is still documented in code as `DEFAULT_LEAD_CONVERSION`, but the resolver does not apply it in Phase 1.

## How to add a real search-to-lead row later

Add a row to `RESEARCHED_RATES` in `src/lead-conversion-rates.js` (and keep the dashboard copy in sync) with `metric_type` set to `search_to_lead`, `search_to_call`, or `search_to_booked_job`, `applied: true`, the rate, the source URL, the year, and the niche aliases. The resolver and estimates box do not need a rewrite for that data change. Then update the user-facing caption if you want it to describe a search-to-lead rate instead of an ad click-to-lead rate.

## Deferred work

Phase 2: when a niche has no studied rate, look up a ballpark on demand. Do not invent a number until that work ships.

Phase 3: refresh a rate only when the tool is being used, about once a month (`REFRESH_INTERVAL_DAYS = 30`). If the tool sits unused for two or three months, nothing should refresh on its own. When the user comes back and that niche is due, refresh then and keep showing the last known rate until the new one lands. Do not add background timers, cron, or idle jobs.
