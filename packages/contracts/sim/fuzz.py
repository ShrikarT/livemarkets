"""
Randomised invariant fuzzer for the Market state machine.

Run:  python3 sim/fuzz.py [runs] [depth]

Mirrors test/Invariant.t.sol. Every action is legal at the time it is taken, so a
broken invariant here is a design bug, not API misuse. Each run ends by draining
the market completely, which is the only honest test of solvency.
"""

import random
import sys

from model import ONE, MIN_SHARES, NUM_TICKS, Market, Outcome, Revert, cost, leg_price, mul_div_up

ACTORS = [f"actor{i}" for i in range(6)]


def one_run(seed: int, depth: int, verbose: bool = False) -> dict:
    rnd = random.Random(seed)
    # Long windows so the fuzzer spends its time in Open, where the interesting
    # state transitions are. Lock/resolve are covered by the settle phase below
    # and by the deterministic tests in test/Market.t.sol.
    m = Market(open_until=100_000, resolve_after=200_000)
    stats = {"place": 0, "crank": 0, "cancel": 0, "fills": 0, "reverts": 0}

    for _ in range(depth):
        action = rnd.choices(
            ["place", "crank", "cancel", "deposit", "withdraw", "warp"],
            weights=[45, 20, 12, 8, 5, 10],
        )[0]
        who = rnd.choice(ACTORS)
        try:
            if action == "place":
                tick = rnd.randrange(NUM_TICKS)
                is_yes = rnd.random() < 0.5
                # deliberately include awkward share counts to stress rounding
                shares = rnd.choice(
                    [
                        MIN_SHARES,
                        MIN_SHARES + 1,
                        rnd.randrange(MIN_SHARES, 5 * 10**18),
                        rnd.randrange(MIN_SHARES, 10**16),
                        3,  # sub-dust, should revert
                    ]
                )
                need = cost(tick, shares, is_yes) if shares >= MIN_SHARES else 0
                if need:
                    m.deposit(who, need)
                m.place(who, tick, shares, is_yes)
                stats["place"] += 1
            elif action == "crank":
                tick = rnd.randrange(NUM_TICKS)
                stats["fills"] += m.match_tick("cranker", tick, rnd.randrange(1, 40))
                stats["crank"] += 1
            elif action == "cancel":
                tick = rnd.randrange(NUM_TICKS)
                m.withdraw_orders_at(who, tick, rnd.random() < 0.5)
                stats["cancel"] += 1
            elif action == "deposit":
                m.deposit(who, rnd.randrange(1, 10**19))
            elif action == "withdraw":
                b = m.bal(who)
                if b:
                    m.withdraw(who, rnd.randrange(1, b + 1))
            elif action == "warp":
                m.now += rnd.randrange(1, 12)
        except Revert:
            stats["reverts"] += 1

        m.check_invariants()

    stats["matched"] = sum(t.matched for t in m.ticks)

    # settle
    m.now = max(m.now, m.resolve_after)
    outcome = rnd.choice([Outcome.YES, Outcome.NO, Outcome.VOID])
    m.resolve(m.resolver, outcome)
    m.check_invariants()

    # nobody can match after the outcome is known
    try:
        m.match_tick("attacker", 0, 10)
        raise AssertionError("matching after resolve must revert")
    except Revert:
        pass

    before_held = m.held
    dust = m.drain()
    m.check_invariants()
    assert m.total_withdrawn <= m.total_deposited, (
        f"users withdrew {m.total_withdrawn} but only deposited {m.total_deposited}"
    )
    # dust is rounding surplus only: it must be tiny next to the money that moved
    assert dust <= NUM_TICKS * 4, f"suspiciously large leftover: {dust} wei"

    stats["outcome"] = outcome.name
    stats["dust_wei"] = dust
    stats["held_before_drain"] = before_held
    return stats


def worked_example() -> None:
    """The example from the spec, to the wei."""
    E = 10**18
    m = Market(open_until=45, resolve_after=60)
    tick = 12  # 0.65

    m.deposit("alice", 65 * E)
    m.place("alice", tick, 100 * E, True)
    m.deposit("bob", 21 * E)
    m.place("bob", tick, 60 * E, False)
    m.match_tick("cranker", tick, 50)

    t = m.ticks[tick]
    assert t.matched == 60 * E, t.matched
    assert t.open_yes == 40 * E, t.open_yes
    assert t.open_no == 0
    assert m.implied_bps() == 6_500

    for outcome, alice_net, bob_net in (
        (Outcome.YES, int(59.4 * E), 0),
        (Outcome.NO, 0, int(59.4 * E)),
        (Outcome.VOID, 39 * E, 21 * E),
    ):
        s = Market(open_until=45, resolve_after=60)
        s.deposit("alice", 65 * E)
        s.place("alice", tick, 100 * E, True)
        s.deposit("bob", 21 * E)
        s.place("bob", tick, 60 * E, False)
        s.match_tick("cranker", tick, 50)
        s.now = 61
        s.resolve(s.resolver, outcome)

        got_alice = s.claim_all("alice")
        assert got_alice == alice_net, (outcome.name, got_alice, alice_net)
        s.check_invariants()

        got_bob = s.claim_all("bob")
        assert got_bob == bob_net, (outcome.name, got_bob, bob_net)
        s.check_invariants()

        # a second claim must pay nothing
        assert s.claim_all("alice") == 0

        refund = s.withdraw_order("alice", tick, True, 0)
        assert refund == 26 * E, refund
        s.check_invariants()

        # alice never gets back more than the 65.00 she put up, plus winnings
        s.drain()
        assert s.total_withdrawn <= s.total_deposited
        print(
            f"  {outcome.name:5}  alice_net={got_alice / E:>6.2f}  bob_net={got_bob / E:>6.2f}"
            f"  refund={refund / E:>5.2f}  dust={s.held}wei"
        )


def rounding_edges() -> None:
    """The rounding decision that keeps matched pairs solvent."""
    # 1 wei of shares at every tick: both legs must together still cover 1 wei.
    for tick in range(NUM_TICKS):
        y = mul_div_up(1, leg_price(tick, True), ONE)
        n = mul_div_up(1, leg_price(tick, False), ONE)
        assert y + n >= 1, tick
        # rounding DOWN would have failed here, which is the whole point:
        down_y = (1 * leg_price(tick, True)) // ONE
        down_n = (1 * leg_price(tick, False)) // ONE
        assert down_y + down_n == 0
    print("  rounding: mulDivUp keeps 1-wei pairs solvent at all 19 ticks (mulDivDown does not)")

    # refunds are exact, never over-refunding a partially filled order
    m = Market(open_until=45, resolve_after=60)
    odd = 7_777_777_777_777_777
    m.deposit("a", 10**19)
    m.place("a", 3, odd, True)
    m.deposit("b", 10**19)
    m.place("b", 3, odd // 3, False)
    paid = m.yes_orders[3][0].paid
    refund = m.withdraw_order("a", 3, True, 0)
    used = mul_div_up(m.yes_orders[3][0].filled, leg_price(3, True), ONE)
    assert refund == paid - used, (refund, paid, used)
    m.check_invariants()
    print("  refunds: exact to the wei on partially filled orders")


def main() -> None:
    runs = int(sys.argv[1]) if len(sys.argv) > 1 else 400
    depth = int(sys.argv[2]) if len(sys.argv) > 2 else 300

    print("worked example")
    worked_example()
    print("rounding edges")
    rounding_edges()

    print(f"fuzzing {runs} runs x {depth} actions")
    totals = {"place": 0, "crank": 0, "cancel": 0, "fills": 0, "reverts": 0, "matched": 0}
    dust = 0
    moved = 0
    outcomes = {"YES": 0, "NO": 0, "VOID": 0}
    for seed in range(runs):
        s = one_run(seed, depth)
        for k in totals:
            totals[k] += s[k]
        dust += s["dust_wei"]
        moved += s["held_before_drain"]
        outcomes[s["outcome"]] += 1

    E = 10**18
    print(f"  orders placed    {totals['place']:>10,}")
    print(f"  cranks           {totals['crank']:>10,}")
    print(f"  cancels          {totals['cancel']:>10,}")
    print(f"  shares matched   {totals['matched'] / E:>10,.2f}")
    print(f"  expected reverts {totals['reverts']:>10,}")
    print(f"  outcomes         {outcomes}")
    print(f"  collateral settled {moved / E:>12,.2f}")
    print(f"  rounding dust left after full drain: {dust} wei across {runs} markets")
    assert totals["matched"] > 0, "fuzzer never matched anything - the run is not testing matching"
    print("ALL INVARIANTS HELD")


if __name__ == "__main__":
    main()
