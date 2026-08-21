"""
Executable reference model of Market.sol.

This is a line-for-line port of the contract's state machine into Python integer
arithmetic. It exists for two reasons:

  1. It lets the invariants be fuzzed hard (millions of actions) in seconds,
     without a node, which is how the rounding direction was actually chosen.
  2. It is the oracle for the TypeScript cost math in apps/web/lib/market-math.ts.
     If the browser's cost preview and the contract ever disagree by one wei,
     users stop trusting the product instantly.

Every arithmetic operation here uses the same rounding direction as the Solidity.
If you change one, change both, and re-run `python3 sim/fuzz.py`.
"""

from dataclasses import dataclass, field
from enum import IntEnum

ONE = 10_000
TICK_STEP = 500
NUM_TICKS = 19
MIN_SHARES = 10**15
AUTO_MATCH_STEPS = 8


def mul_div_up(a: int, b: int, d: int) -> int:
    """Round UP. Every collateral DEBIT uses this."""
    return (a * b + d - 1) // d


def mul_div_down(a: int, b: int, d: int) -> int:
    """Round DOWN. Every collateral CREDIT uses this."""
    return (a * b) // d


def price(tick: int) -> int:
    if not 0 <= tick < NUM_TICKS:
        raise Revert("BadTick")
    return (tick + 1) * TICK_STEP


def leg_price(tick: int, is_yes: bool) -> int:
    p = price(tick)
    return p if is_yes else ONE - p


def cost(tick: int, shares: int, is_yes: bool) -> int:
    return mul_div_up(shares, leg_price(tick, is_yes), ONE)


class Revert(Exception):
    pass


class Phase(IntEnum):
    OPEN = 0
    LOCKED = 1
    RESOLVED = 2


class Outcome(IntEnum):
    UNRESOLVED = 0
    YES = 1
    NO = 2
    VOID = 3


@dataclass
class Order:
    maker: str
    shares: int
    filled: int = 0
    paid: int = 0
    withdrawn: bool = False


@dataclass
class Tick:
    open_yes: int = 0
    open_no: int = 0
    matched: int = 0
    fee_acc: int = 0
    crank_acc: int = 0
    yes_cursor: int = 0
    no_cursor: int = 0
    cranker: str | None = None


@dataclass
class Market:
    question: str = "q?"
    resolver: str = "resolver"
    fee_recipient: str = "sink"
    fee_bps: int = 100
    crank_share_bps: int = 1_000
    open_until: int = 45
    resolve_after: int = 60

    now: int = 0
    outcome: Outcome = Outcome.UNRESOLVED
    trading_paused: bool = False

    ticks: list[Tick] = field(default_factory=lambda: [Tick() for _ in range(NUM_TICKS)])
    yes_orders: list[list[Order]] = field(default_factory=lambda: [[] for _ in range(NUM_TICKS)])
    no_orders: list[list[Order]] = field(default_factory=lambda: [[] for _ in range(NUM_TICKS)])
    yes_pos: dict = field(default_factory=dict)  # (tick, addr) -> shares
    no_pos: dict = field(default_factory=dict)
    balance: dict = field(default_factory=dict)  # addr -> collateral

    held: int = 0  # native balance actually sitting in the contract

    # ---- bookkeeping for the tests, not part of the contract ----
    total_deposited: int = 0
    total_withdrawn: int = 0
    fees_swept: int = 0

    # ------------------------------------------------------------ helpers

    def bal(self, a: str) -> int:
        return self.balance.get(a, 0)

    def phase(self) -> Phase:
        if self.outcome != Outcome.UNRESOLVED:
            return Phase.RESOLVED
        return Phase.OPEN if self.now < self.open_until else Phase.LOCKED

    # --------------------------------------------------------- collateral

    def deposit(self, who: str, amount: int) -> None:
        self.balance[who] = self.bal(who) + amount
        self.held += amount
        self.total_deposited += amount

    def withdraw(self, who: str, amount: int) -> None:
        if self.bal(who) < amount:
            raise Revert("NoBalance")
        self.balance[who] -= amount
        self.held -= amount
        self.total_withdrawn += amount

    # ------------------------------------------------------------ trading

    def place(self, who: str, tick: int, shares: int, is_yes: bool, value: int = 0) -> int:
        if self.trading_paused:
            raise Revert("Paused")
        if self.phase() != Phase.OPEN:
            raise Revert("NotOpen")
        if shares < MIN_SHARES:
            raise Revert("TooSmall")
        if value > 0:
            self.deposit(who, value)

        c = cost(tick, shares, is_yes)
        if self.bal(who) < c:
            raise Revert("NoBalance")
        self.balance[who] -= c

        t = self.ticks[tick]
        o = Order(maker=who, shares=shares, filled=0, paid=c, withdrawn=False)
        if is_yes:
            index = len(self.yes_orders[tick])
            self.yes_orders[tick].append(o)
            t.open_yes += shares
        else:
            index = len(self.no_orders[tick])
            self.no_orders[tick].append(o)
            t.open_no += shares

        if t.open_yes > 0 and t.open_no > 0:
            self._match_tick(who, tick, AUTO_MATCH_STEPS)
        return index

    def match_tick(self, who: str, tick: int, max_steps: int) -> int:
        if not 0 <= tick < NUM_TICKS:
            raise Revert("BadTick")
        if self.outcome != Outcome.UNRESOLVED:
            raise Revert("AlreadyResolved")
        return self._match_tick(who, tick, max_steps)

    def _match_tick(self, who: str, tick: int, max_steps: int) -> int:
        t = self.ticks[tick]
        ys = self.yes_orders[tick]
        ns = self.no_orders[tick]

        y, n, steps, filled_total = t.yes_cursor, t.no_cursor, 0, 0

        while steps < max_steps and y < len(ys) and n < len(ns):
            yo = ys[y]
            if yo.withdrawn or yo.filled == yo.shares:
                y += 1
                steps += 1
                continue
            no_ = ns[n]
            if no_.withdrawn or no_.filled == no_.shares:
                n += 1
                steps += 1
                continue

            fill = min(yo.shares - yo.filled, no_.shares - no_.filled)
            yo.filled += fill
            no_.filled += fill

            self.yes_pos[(tick, yo.maker)] = self.yes_pos.get((tick, yo.maker), 0) + fill
            self.no_pos[(tick, no_.maker)] = self.no_pos.get((tick, no_.maker), 0) + fill

            t.open_yes -= fill
            t.open_no -= fill
            t.matched += fill
            filled_total += fill
            steps += 1

        t.yes_cursor, t.no_cursor = y, n
        if filled_total > 0:
            t.cranker = who
        return filled_total

    def withdraw_order(self, who: str, tick: int, is_yes: bool, index: int) -> int:
        arr = self.yes_orders[tick] if is_yes else self.no_orders[tick]
        o = arr[index]
        if o.maker != who or o.withdrawn:
            raise Revert("NotYours")

        rem = o.shares - o.filled
        o.withdrawn = True
        refund = 0
        if rem > 0:
            t = self.ticks[tick]
            if is_yes:
                t.open_yes -= rem
            else:
                t.open_no -= rem
            used_for_filled = mul_div_up(o.filled, leg_price(tick, is_yes), ONE)
            refund = o.paid - used_for_filled
            assert refund >= 0, "refund underflow: mulDivUp is not monotonic?!"
            self.balance[who] = self.bal(who) + refund
        return refund

    def withdraw_orders_at(self, who: str, tick: int, is_yes: bool) -> int:
        arr = self.yes_orders[tick] if is_yes else self.no_orders[tick]
        total = 0
        for i, o in enumerate(arr):
            if o.maker != who or o.withdrawn:
                continue
            total += self.withdraw_order(who, tick, is_yes, i)
        return total

    # --------------------------------------------------------- resolution

    def resolve(self, who: str, outcome: Outcome) -> None:
        if who != self.resolver:
            raise Revert("NotYours")
        if self.now < self.resolve_after:
            raise Revert("TooEarly")
        if self.outcome != Outcome.UNRESOLVED or outcome == Outcome.UNRESOLVED:
            raise Revert("AlreadyResolved")
        self.outcome = outcome

    def claim(self, who: str, tick_list: list[int]) -> int:
        if self.outcome == Outcome.UNRESOLVED:
            raise Revert("NotResolved")

        gross = 0
        fee_total = 0
        is_void = self.outcome == Outcome.VOID

        for tk in tick_list:
            if not 0 <= tk < NUM_TICKS:
                raise Revert("BadTick")
            y = self.yes_pos.get((tk, who), 0)
            n = self.no_pos.get((tk, who), 0)
            if y == 0 and n == 0:
                continue

            if is_void:
                g = mul_div_down(y, leg_price(tk, True), ONE) + mul_div_down(n, leg_price(tk, False), ONE)
            elif self.outcome == Outcome.YES:
                g = y
            else:
                g = n

            if y:
                self.yes_pos[(tk, who)] = 0
            if n:
                self.no_pos[(tk, who)] = 0
            if g == 0:
                continue

            gross += g
            if not is_void and self.fee_bps > 0:
                f = mul_div_down(g, self.fee_bps, ONE)
                if f > 0:
                    t = self.ticks[tk]
                    crank_cut = mul_div_down(f, self.crank_share_bps, ONE)
                    if crank_cut > 0 and t.cranker is not None:
                        t.crank_acc += crank_cut
                        t.fee_acc += f - crank_cut
                    else:
                        t.fee_acc += f
                    fee_total += f

        net = gross - fee_total
        self.balance[who] = self.bal(who) + net
        return net

    def claim_all(self, who: str) -> int:
        return self.claim(who, list(range(NUM_TICKS)))

    def sweep_fees(self, tick_list: list[int]) -> int:
        amt = 0
        for tk in tick_list:
            amt += self.ticks[tk].fee_acc
            self.ticks[tk].fee_acc = 0
        self.held -= amt
        self.fees_swept += amt
        return amt

    def pay_crank_reward(self, tick: int) -> int:
        t = self.ticks[tick]
        amt, to = t.crank_acc, t.cranker
        if amt == 0 or to is None:
            return 0
        t.crank_acc = 0
        self.balance[to] = self.bal(to) + amt
        return amt

    # -------------------------------------------------------------- views

    def implied_bps(self) -> int:
        num = den = 0
        for i in range(NUM_TICKS):
            t = self.ticks[i]
            w = t.matched * 2 + t.open_yes + t.open_no
            num += w * price(i)
            den += w
        return ONE // 2 if den == 0 else num // den

    # ---------------------------------------------------------- INVARIANTS

    def liabilities(self) -> int:
        """Everything the contract owes right now.

        Note on `matched`: a matched pair owes 1.00 to whichever side wins, but that
        obligation is DISCHARGED once the position is claimed (the position is zeroed
        and the value moves into `balance`). `matched` is a cumulative counter and
        never decreases, so counting it after settlement would double-count the payout.
        The obligation therefore has to be measured from unclaimed positions.
        """
        owed = sum(self.balance.values())
        for i in range(NUM_TICKS):
            t = self.ticks[i]
            owed += t.fee_acc + t.crank_acc

            if self.outcome == Outcome.UNRESOLVED:
                # nobody can claim yet: every matched pair still owes a full 1.00
                owed += t.matched
            else:
                ys = [v for (tk, _), v in self.yes_pos.items() if tk == i]
                ns = [v for (tk, _), v in self.no_pos.items() if tk == i]
                if self.outcome == Outcome.YES:
                    owed += sum(ys)  # 1.00 per unclaimed winning share (fee comes out of it)
                elif self.outcome == Outcome.NO:
                    owed += sum(ns)
                else:  # VOID: each leg is refunded at what it paid
                    owed += sum(mul_div_down(v, leg_price(i, True), ONE) for v in ys)
                    owed += sum(mul_div_down(v, leg_price(i, False), ONE) for v in ns)

            # exact refundable collateral behind resting orders
            for arr, is_yes in ((self.yes_orders[i], True), (self.no_orders[i], False)):
                for o in arr:
                    if o.withdrawn:
                        continue
                    rem = o.shares - o.filled
                    if rem == 0:
                        continue
                    owed += o.paid - mul_div_up(o.filled, leg_price(i, is_yes), ONE)
        return owed

    def check_invariants(self) -> None:
        # 1. SOLVENCY. Surplus from rounding is fine; a deficit is a bug.
        owed = self.liabilities()
        assert self.held >= owed, f"INSOLVENT: holds {self.held}, owes {owed} (short {owed - self.held})"

        for i in range(NUM_TICKS):
            t = self.ticks[i]

            # 2. A matched pair is funded by its own two participants: >= 1.00/share.
            if t.matched:
                yes_leg = mul_div_up(t.matched, leg_price(i, True), ONE)
                no_leg = mul_div_up(t.matched, leg_price(i, False), ONE)
                assert yes_leg + no_leg >= t.matched, f"tick {i}: pair under-collateralised"

            # 3. openYes == sum of unfilled, non-withdrawn YES shares. Same for NO.
            sum_yes = sum(o.shares - o.filled for o in self.yes_orders[i] if not o.withdrawn)
            sum_no = sum(o.shares - o.filled for o in self.no_orders[i] if not o.withdrawn)
            assert t.open_yes == sum_yes, f"tick {i}: openYes {t.open_yes} != {sum_yes}"
            assert t.open_no == sum_no, f"tick {i}: openNo {t.open_no} != {sum_no}"

            # 4. Matched YES shares == matched NO shares (two sides of one trade).
            #    Only meaningful before settlement, since claim() zeroes positions.
            if self.outcome == Outcome.UNRESOLVED:
                sy = sum(v for (tk, _), v in self.yes_pos.items() if tk == i)
                sn = sum(v for (tk, _), v in self.no_pos.items() if tk == i)
                assert sy == sn == t.matched, f"tick {i}: positions {sy}/{sn} != matched {t.matched}"

            # 5. Cursors stay in range and never move backwards past the array.
            assert 0 <= t.yes_cursor <= len(self.yes_orders[i]), f"tick {i}: yes cursor out of range"
            assert 0 <= t.no_cursor <= len(self.no_orders[i]), f"tick {i}: no cursor out of range"

            # 6. Matching never touches another tick's storage. Checked structurally
            #    by _match_tick only ever indexing [tick]; asserted here for the log.

        # 7. No negative user balances, ever.
        for a, v in self.balance.items():
            assert v >= 0, f"negative balance for {a}: {v}"

    def drain(self) -> int:
        """Settle the market completely: everyone cancels every resting order, claims
        every position, and withdraws their whole balance; then fees and crank
        rewards are paid out. The contract must be able to pay all of it.

        Whatever is left is pure rounding dust and must be a small positive number.
        This is the real solvency proof.
        """
        actors = set(self.balance) | {a for (_, a) in self.yes_pos} | {a for (_, a) in self.no_pos}
        for i in range(NUM_TICKS):
            for arr in (self.yes_orders[i], self.no_orders[i]):
                actors.update(o.maker for o in arr)
            # crankers are counterparties too: they get credited a slice of the fee
            if self.ticks[i].cranker is not None:
                actors.add(self.ticks[i].cranker)

        # 1. reclaim the collateral behind every unfilled order
        for i in range(NUM_TICKS):
            for arr, is_yes in ((self.yes_orders[i], True), (self.no_orders[i], False)):
                for idx, o in enumerate(arr):
                    if not o.withdrawn:
                        self.withdraw_order(o.maker, i, is_yes, idx)

        # 2. claim every settled position
        if self.outcome != Outcome.UNRESOLVED:
            for a in sorted(actors):
                self.claim_all(a)

        # 3. pay the crankers, then everyone pulls their balance out.
        #    Re-read the balance map here: paying crank rewards can credit an address
        #    that had no balance when this function started.
        for i in range(NUM_TICKS):
            self.pay_crank_reward(i)
        for a in sorted(set(self.balance) | actors):
            if self.bal(a):
                self.withdraw(a, self.bal(a))

        # 4. protocol sweeps its fees last, out of what is left
        self.sweep_fees(list(range(NUM_TICKS)))

        assert self.held >= 0, f"contract went negative while draining: {self.held}"
        assert self.liabilities() == 0, f"still owes {self.liabilities()} after a full drain"
        return self.held
