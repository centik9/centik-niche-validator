# Pending Abel review

Spend baseline: DataForSEO `GET /v3/appendix/user_data` returns `money.total` and `money.balance`, not `money.total_spent`. Account spend is `total − balance` when `total_spent` is absent. The production baseline, set once in `DATAFORSEO_SPENT_BASELINE_USD`, is the derived value `1.17145`.

These sourced ranges were read on 2026-11-09 from the allowlist. `reviewed` is false. None of them may paint a row green. AiA can relay this list.

## Used on a row that had no reviewed price

- Bathroom remodel plumbing. Angi rough-in plumbing, $3,000 to $20,000 per bathroom. Quote: "In 2026, the national average cost of rough-in plumbing for a bathroom is $6,500. Most homeowners spend between $3,000 and $20,000". https://www.angi.com/articles/what-does-it-cost-run-new-plumbing-toilet-shower-and-sink-room-adjacent-other-bathroom.htm The same publisher's remodel page says plumbing updates during a bathroom remodel average $800. That is one average, not a range, so the row uses the rough-in range and says it is pending review.
- Repipe consultation. No consultation-only fee was published. Angi publishes the whole-home repipe job at $1,500 to $15,000. Quote: "In 2026, the national average cost to repipe a house is $7,500. Most homeowners spend between $1,500 and $15,000". https://www.angi.com/articles/cost-to-repipe-a-house.htm The row shows that job range, labeled pending review, and says it is not a consultation fee.

## Found, and not used to replace a reviewed row

- Garage door repair. HomeGuide, Angi, and HomeAdvisor still do not publish a general emergency or after-hours job range. HomeGuide does publish emergency cable repair at $250 to $350. Quote: "Emergency cable repair service costs $250 to $350." https://homeguide.com/costs/garage-door-cable-repair-cost The scored row stays on the reviewed HomeGuide standard range of $150 to $350 per job.
- AC repair. HomeGuide publishes emergency labor at $160 to $250 per hour. Quote: "AC technicians charge $75 to $150 per hour for labor during regular business hours and $160 to $250 per hour for emergency repairs during the night, weekend, or a holiday." https://homeguide.com/costs/ac-repair-cost The HVAC row already uses the reviewed HomeGuide emergency rate of $140 to $250 per hour, so this second range stays pending.
