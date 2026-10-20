---
title: 'Reading the Elements: A Two-Thousand-Year Edifice Built on Five Requests'
description: 'The most rigorous of books does not open with five self-evident truths but with five requests you must grant; even its first proposition hides an assumption it never states. With a thirteen-book skeleton, five annotated passages, a note on editions, and three reading habits.'
link: reading-22-elements
catalog: true
math: true
date: 2026-05-17 20:30:00
updated: 2026-05-17 22:10:00
categories: ['书摘']
tags: ['书摘', '数学']
draft: false
---

## 1. Why I Read It

At school, geometry meant memorising theorems and drawing auxiliary lines. I never read it as a book, only as a pile of results I had to keep. Why they held, on what grounds they held — the teacher did not say, and I did not ask.

Years later a question came: a book used as a textbook for two thousand years, and held up as a model of truth, what does it stand on? I opened it with that question and met two surprises.

One was the beginning. What it sets at the front is not five self-evident truths but five requests it asks you to **grant**. The other was its first proposition: to construct an equilateral triangle, over in a few steps — yet I stared at the figure for a long while before I saw the unstated assumption it quietly used.

## 2. The Skeleton First

:::info
The Elements runs to thirteen books and about 465 propositions (the standard count is 465). It was put together around 300 BC and is a great tidying-up of the geometry known in Alexandria. Book One opens with 23 definitions, 5 postulates and 5 common notions. Nothing in it uses algebraic symbols: wherever a quantity is handled, it is handled with lines and figures — so whole stretches use a diagram in place of a formula, and reading feels like work with the hands rather than calculation.
:::

The division of labour across the thirteen books, set out as a table:

| Book | Contents |
| :--- | :--- |
| 1 | Definitions, postulates, axioms; basic triangle and parallel-line theorems, including the Pythagorean theorem |
| 2 | Algebraic identities handled geometrically, the so-called “geometric algebra” |
| 3–4 | The properties of circles, and inscribed and circumscribed polygons |
| 5–6 | The theory of proportion and similar figures |
| 7–9 | Number theory: divisibility, proportion, and the infinitude of primes |
| 10 | The classification of incommensurable magnitudes |
| 11–12 | Solid geometry, and volume by the method of exhaustion |
| 13 | The construction of the five regular solids, on which the work closes |

+++primary Expand: the propositions I kept returning to (my own annotations)
- **I.1**: to construct an equilateral triangle. The book’s first proof, only a few steps long
- **I.5**: the base angles of an isosceles triangle are equal. Nicknamed the “bridge of asses” in the Middle Ages, said to be the first hurdle in learning geometry
- **I.47**: the Pythagorean theorem. Its figure is called the “bride’s chair”, or the windmill
- **V**: the theory of proportion, handling ratios with magnitudes rather than numbers — technically the hardest book
- **IX.20**: the primes are more than any assigned multitude. The most famous purely number-theoretic proposition in the work
- **XIII**: the construction of the five regular solids, where the work comes to rest
+++

One warning: “postulate” and “axiom” are often lumped together in translation, but they were kept apart. The five postulates concern operations in the world of figures — drawing a line, drawing a circle, intersecting; the five common notions concern general rules about equality. Keep the two separate and every later book tells you what it takes for granted.

## 3. Passages and Marginalia

### On the beginning: the first line is a request

> Let it be granted: that from any point to any point a straight line can be drawn.
>
> — Book 1, Postulate 1
>
> *My own working translation.*

==It stands first in the whole book, yet its wording is a “let it be granted” — not a statement of fact but a request for your consent.== Euclid builds the foundation as an agreement: grant me these things first, and only then can we begin to talk.

My note: this step is remarkably modern. Any rigorous reasoning has to be clear about where its premises come from. He does not pretend the premises fell from the sky; he lays them on the table and asks whether you accept them.

### On the postulate that least looks like one

> If a straight line falling on two straight lines makes the interior angles on the same side less than two right angles, the two straight lines, produced without limit, meet on that side on which the angles are less than the two right angles.
>
> — Book 1, Postulate 5
>
> *My own working translation.*

++着重点++{.dot}The first four postulates are short and matter-of-fact: two points joined by a line, a line extended, a circle drawn, all right angles equal. ==Only the fifth is long and tangled, and looks nothing like something “obvious”.== For over two thousand years people tried to derive it from the others, until in the nineteenth century someone turned around and admitted it: not a necessity, merely one choice among several.

My note: this awkward postulate later grew into the whole field of non-Euclidean geometry. The least conspicuous assumption became the most fruitful one.

### On the first proof: an assumption no one wrote down

> On a given finite straight line, to construct an equilateral triangle.
>
> — Book 1, Proposition 1
>
> *My own working translation.*

==This is the first proof in the book, so short it is almost invisible.== Draw two circles with the ends of the line as centres, take the point where they meet, join it up, and the triangle is done.

:::success
**The step hidden inside the figure**

Euclid’s construction takes the intersection of the two circles. But search all five postulates and none guarantees that two circles will meet — he assumed it, without saying so. More than two thousand years later, when Hilbert rewrote the axioms of geometry, he added a batch of just such tacit premises. This is not fault-finding; it is seeing one thing clearly: the most careful book will still leave a gap exactly where matters seem obvious[^1].
:::

My note: only here did I understand that “rigour” does not mean having no holes, but putting the holes somewhere you are bound to run into them.

### On the most famous proposition of all

> In right-angled triangles, the square on the side subtending the right angle is equal to the squares on the sides containing the right angle.
>
> — Book 1, Proposition 47
>
> *My own working translation.*

[笔记]{.label .primary}==Put into today’s notation, this is $a^2+b^2=c^2$.== But Euclid uses no letters: he draws three squares and, by cutting and pasting, shows how the large square is made from the two small ones. One and the same fact — symbols on one side, a figure on the other — and he chose the figure.

My note: the diagram was called the “bride’s chair” in the Middle Ages, and some thought it looked like a windmill. The name got grander and grander; the point is a single line — rearrange it, and the area is conserved.

### On an unexpected book

> The primes are more than any assigned multitude of prime numbers.
>
> — Book 9, Proposition 20
>
> *My own working translation.*

++着重点++{.dot}==A book that talks of figures and segments from beginning to end suddenly gives a purely number-theoretic claim.== The proof is startlingly clean: take any list of primes, multiply them together and add one; the result is either itself prime, or divisible by a prime not on the list — either way, there is a prime beyond the list.

My note: this book shows the temperament of the work best. It is not about how striking any single result is; it is about how far the act of proof itself can be pushed.

:::warning
**Before you start: two small things**

One is the edition. In translation, “postulate”, “axiom” and “definition” are not handled consistently; the same place may be rendered as a postulate in one version and a hypothesis in another, and reading gets tangled. To choose a version, turn to the opening of Book One and see how it lays out those three headings at the top; that tells you the book’s temperament. The other is method. It uses no symbols and relies on construction and cutting-and-pasting, so keep paper and a pencil nearby — drawing a figure through once is much faster than reading the words through once[^2].
:::

## 4. What I Put to Use

1. **In a proof, first trace which earlier propositions it uses.** Every proposition stands on results already proved. After finishing one, jot down the numbers it cites; across a book or two, the dependencies show up as a web — and you see why it had to begin from postulates.
2. **Keep paper and pencil and draw the figures.** This book was written for the hands. Two circles, a secant, a few squares: drawn, and merely imagined, are two different things. Whenever you read “to construct”, stop and draw.
3. **Treat the postulates as agreed premises, not as truths.** Read that way, “can the fifth postulate be changed” stops being an idle question and becomes one that naturally arises — and in time it really was changed, and really did grow a new geometry.

## 5. Closing

Closing the book undid a prejudice: I had thought a book like this has no “author”, only results. Having read it, I see it as an artisan’s record from the workshop — first settling the premises with you, then laying the whole building up step by step, and at the last book still keeping one move back, closing with the five regular solids.

Next: the Odyssey. A book that asks you to follow proof step by step is done; the next asks you to follow a drifting step by step. One takes “certainty” to its limit, the other turns “accident” into a life; I want to see how far apart the two kinds of stepping really are.

[^1]: The gap lasted a long while: more than two thousand two hundred years lie between Euclid and Hilbert. When Hilbert rewrote the axioms of geometry in 1899, he supplied a batch of premises that had been assumed but never stated, among them the intersection of circles. The case is often used to make one point: what we call “obvious” is usually just “never questioned”.
[^2]: On the names: in Euclid’s Greek, the first five are αἰτήματα, literally “things asked for”, hence “postulates”; the later ones are κοιναὶ ἔννοιαι, “common notions”, hence “axioms”. Different renderings leave readers with a different sense of which items are requests and which are shared agreements.
