---
tags:
    - Opinion
    - Engineering
description: |
    Why attaching yourself to a single language is marketable but bad for your code — and how every tool constrains the products you build.
image: https://i.stack.imgur.com/686wZ.png

---

# Language agnosticism is not marketable, and that's a problem.

## The Problem

Recruiters search LinkedIn for *"Java Developer"* or *"React Developer"*. Job postings list languages and tools with required "Years of Experience" — sometimes exceeding how long the technology has existed[^1].

Many "talent acquisition" roles are really risk management: hire someone who has survived long enough to be considered safe. Risk-averse strategies compress outcomes without improving them[^2], and often make them worse[^3].

!!! quote "Isaac Lyman[^4]"

    *Employers are constantly at risk of hiring developers with 20 years of job experience but no passion or drive, instead of developers with 4 years of job experience, 6 years of childhood hackery, 3 years of weekends on GitHub, and a lifetime of enthusiasm for cool software.*

## Frameworks, Languages, Standards, Platforms

For non-technical readers, and even tech-literate recruiters, it can be hard to understand the jargon and differentiate between different technologies. Let's imagine a situation where you are looking for a recruit with experience managing Swagger definitions. Quick quiz - of the following terms, which is the most relevant to this requirement?

??? hint "AsyncAPI"
    Related, but not what we are looking for!

??? hint "REST API"
    Nope!

??? hint "OpenAPI"
    Correct!

??? hint "FastAPI"
    Related, but not what we are looking for!

## Programming Languages as Constraints

One of the most popular books for those working in IT is 'The Phoenix Project'[^tpp], and for good reason. It provides justification and explanation for principles that undergird the DevOps[^devops] movement and does so while remaining relatable and even humorous at times.

One of the most repeated elements is the comparison of IT to a manufacturing plant, where the only difference is that instead of producing automotive parts, IT produces software. This analogy is used repeatedly to shoot down the idea that software development is a special industry that must be treated like a bespoke artisan furniture business.

The analogy extends further: programming languages impact products the same way manufacturing tools do. Consider a vacuum forming machine:

<figure markdown>
  <figcaption>Vacuum Forming Luggage</figcaption>
</figure>

Vacuum forming provides huge value while imposing real constraints. FormLabs[^formlabs] explains:

!!! quote "FormLabs[^formlabs]"

    Vacuum forming is only viable for parts with relatively **thin walls** and **simple geometries**. The finished parts may not have a **consistent wall thickness**, and **concave parts** with a deep draw are difficult to produce using vacuum forming.

If you are a product designer, and the main tool at your disposal is a vacuum forming machine, your parts will inevitably be designed around these constraints. If you were limited to just this machine, it would be impossible to produce certain parts. For example:

*Business* : We need you to design us a ladder.

*Designer* : Hmm, our existing machinery has a forming bed that is limited to 4' in length, so it would not be possible to form a ladder in one piece.

*Business* : Okay, well lets just make it out of 4' segments and then we will combine the pieces after assembly.

*Designer* : That could work, but another problem is that a ladder has complex geometry. The rungs need to be round and the rails need to be flat. Vacuum forming cannot produce parts with varying wall thickness and sharp corners without secondary operations.

The result is a product that works but is heavier, has more joints, and costs more to produce than if it had been designed for the right manufacturing process from the start. Replace "vacuum forming machine" with "JavaScript" or "Java" and the analogy holds. Every programming language comes with its own set of constraints:

- **JavaScript** makes async I/O easy via the event loop, but CPU-bound parallelism requires workers
- **Java** provides robust typing and tooling but requires significant ceremony
- **Python** offers rapid iteration but struggles with CPU-bound parallelism
- **Rust** guarantees memory safety but demands explicit lifetime management

None of these are inherently bad. They are trade-offs. The problem arises when an organization standardizes on one language and then tries to solve every problem with it. The result is software that works, but carries the weight of the wrong tool.

## Programming Lifecycle

As programming languages become increasingly high-level and PaaS becomes the standard for enterprises, the lifetime of a particular stack decreases. For those unfamiliar, lets take the example of the LAMP stack - Linux, Apache, MySQL, and PHP. This stack has been around for close to 30 years at this point, and the most common example of this is Wordpress, which powers over 40% of all websites on the internet[^w3techs]. Similarly, Ruby on Rails was released in 2004 and has seen extensive use the 20 years since then.

If you are hiring for these stacks, it could make sense to find developers who have significant experience on these stacks. If you need developers for a monolithic PHP application, it makes sense to write "5 years of experience with Laravel" on the requirements, because no-one is coming out with hot new PHP frameworks in 2023.

If you are maintaining a PHP legacy application, security audits are not optional — these codebases are disproportionately vulnerable to XSS and SQL injection, and the tooling ecosystem has not kept pace with modern frameworks.[^php-vice][^w3techs]

The brutal lifecycle of JavaScript frameworks (documented by Stack Overflow[^stack]) shows how quickly frontend technologies rise and fall — and why betting your career on one is risky.

## No-Code and Visual Programming

This is where the analogy becomes particularly relevant today. The rise of no-code and low-code platforms (UiPath, Power Apps, Retool) represents a bet that visual, domain-specific tools can produce software faster than general-purpose programming languages.

The vacuum forming analogy suggests a cautionary note: these platforms will be excellent for a specific range of problems — thin walls and simple geometries — but will struggle with anything that requires deep customization or non-standard behavior. When your application inevitably needs to do something outside the platform's design, you will face the same choice as our ladder designer: work around it, accept the inefficiency, or rebuild with different tools.

## Programming is Learning

!!! quote "Jeff Atwood[^1]"

    *Somehow, they've forgotten that ***what software developers do best is learn***. Employers should be looking for passionate, driven, flexible self-educators who have a proven ability to code in whatever language — and serving them up interesting projects they can engage with.*

## What This Means for Developers

If you are a developer early in your career, the pressure to specialize is real. Job listings demand specific stacks, and the algorithms that filter resumes reward keyword density. But investing deeply in a single technology carries risk: when that technology falls out of favor, your years of experience lose value.

The developers I respect most are the ones who can pick up any codebase, understand its patterns, and contribute meaningfully within weeks. They are not "Python Developers" or "Go Developers." They are problem solvers who happen to use a particular language today.

## A Better Approach

For companies, the fix is straightforward: interview for fundamentals. Data structures, system design, debugging, communication. A developer who understands these will be productive in any language within a reasonable ramp-up period.

For developers, invest in concepts that transcend languages: design patterns, testing strategies, observability, security. These skills compound across your entire career, regardless of which syntax you are writing on a given day.

The lesson is not that vacuum forming is bad, or that visual languages are inferior. It is that every tool imposes constraints, and the best engineers understand the constraints of their tools well enough to know when a different tool is needed. Language agnosticism is not just about career flexibility; it is about building better products by choosing the right constraints for the problem at hand.

[^1]: [The YOE Myth](https://blog.codinghorror.com/the-years-of-experience-myth/)
[^2]: [Your Company Is Too Risk Averse](https://hbr.org/2020/03/your-company-is-too-risk-averse)
[^3]: [Loss Aversion](https://en.wikipedia.org/wiki/Loss_aversion)
[^4]: [YOE is a garbage metric](https://dev.to/isaacdlyman/years-of-experience-is-a-garbage-metric)
[^tpp]: [The Phoenix Project](https://itrevolution.com/product/the-phoenix-project/)
[^stack]: [The Brutal Lifecycle of JavaScript Frameworks](https://stackoverflow.blog/2018/01/11/brutal-lifecycle-javascript-frameworks/)
[^formlabs]: [Read 'Introduction To Vacuum Forming'](https://formlabs.com/blog/introduction-to-vacuum-forming/)
[^w3techs]: [Wordpress 43.2%](https://w3techs.com/technologies/details/cm-wordpress)
[^php-vice]: [The most hackable programming language is PHP](https://www.vice.com/en/article/ezp4ek/new-analysis-the-most-hackable-programming-language-is-php-by-a-mile)
