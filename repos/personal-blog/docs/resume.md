---
description: |
  Interactive resume of Reed Sutliff — senior software engineer specializing
  in backend development, API design, and developer tooling.
---

<link rel="stylesheet" href="/assets/resume/interactive.css">

<div class="rf-container" id="rf-app">

<div id="rf-step-0" class="rf-step active">
  <div class="rf-question">Who are you?</div>
  <button class="rf-btn" onclick="rf.go(1)"><span class="rf-emoji">👔</span> I'm a hiring manager or tech lead</button>
  <button class="rf-btn" onclick="rf.setRecruiter(); rf.go(1)"><span class="rf-emoji">🔍</span> I'm a recruiter</button>
  <button class="rf-btn rf-btn-muted" onclick="rf.go('0b')">Just browsing</button>
</div>

<div id="rf-step-0b" class="rf-step">
  <div class="rf-question">Well hey, glad you're here. While you're at it — know anyone who needs a solid developer?</div>
  <button class="rf-btn" onclick="rf.go(1)"><span class="rf-emoji">😄</span> I might! Let me see what you've got</button>
  <button class="rf-btn rf-btn-muted" onclick="rf.go(1)"><span class="rf-emoji">👀</span> Just looking, but you seem cool</button>
</div>

<div id="rf-step-1" class="rf-step">
  <div class="rf-question">Do you need a developer on your team?</div>
  <button class="rf-btn" onclick="rf.go(2)"><span class="rf-emoji">👍</span> Yes</button>
  <button class="rf-btn rf-btn-muted" onclick="rf.go('1b')">No</button>
</div>

<div id="rf-step-1b" class="rf-step">
  <div class="rf-question">Yeah, but I mean you <em>want</em> one, right?</div>
  <button class="rf-btn" onclick="rf.go(2)"><span class="rf-emoji">😅</span> Yes, fair point</button>
  <button class="rf-btn rf-btn-muted" onclick="rf.go('1c')">No, I really don't</button>
</div>

<div id="rf-step-1c" class="rf-step">
  <div class="rf-question">I get it. You have enough on your plate. You need someone you can just hand work to, and they come back with a finished feature?</div>
  <button class="rf-btn" onclick="rf.go(3)"><span class="rf-emoji">🎯</span> Yes, exactly that</button>
  <button class="rf-btn rf-btn-muted" onclick="rf.go('1d')">No, that's not it either</button>
</div>

<div id="rf-step-1d" class="rf-step">
  <div class="rf-question">Alright, hear me out — what if I told you there's a developer who can do all of that and more?</div>
  <button class="rf-btn" onclick="rf.go(2)"><span class="rf-emoji">👀</span> Okay, you have my attention</button>
  <button class="rf-btn" onclick="rf.go(2)"><span class="rf-emoji">🤨</span> ...fine, convince me</button>
</div>

<div id="rf-step-2" class="rf-step">
  <div class="rf-question">Great! What is your team missing?</div>
  <button class="rf-btn" data-variant="backend-developer" onclick="rf.pickVariant(this)">
    <span class="rf-emoji">🛠️</span> We need someone to make our backend suck less
  </button>
  <button class="rf-btn" data-variant="fullstack-developer" onclick="rf.pickVariant(this)">
    <span class="rf-emoji">🚀</span> We need someone to build this entire feature and there's no allocation for the next 6 months!
  </button>
  <button class="rf-btn" data-variant="agentic-engineer" onclick="rf.pickVariant(this)">
    <span class="rf-emoji">🤖</span> We need someone to improve our dev processes and help us break out of old crappy workflows
  </button>
  <button class="rf-btn" data-variant="forward-deployed-swe" onclick="rf.pickVariant(this)">
    <span class="rf-emoji">🤝</span> We need someone who can work alongside our team and hit the ground running
  </button>
</div>

<div id="rf-step-3" class="rf-step">
  <div class="rf-question">What skills are most important to you?</div>
  <p style="color: var(--md-default-fg-color--light, #666); font-size: 0.9rem; margin-bottom: 0.5rem;">Pick a few — this confirms the right fit</p>
  <div class="rf-skills-grid" id="rf-skills"></div>
  <button class="rf-btn" onclick="rf.finish()" style="margin-top: 1rem;">
    <span class="rf-emoji">🎉</span> Show me the guy
  </button>
</div>

<div id="rf-step-final" class="rf-step">
  <div class="rf-final-card">
    <div style="font-size: 3rem; margin-bottom: 0.5rem;">🎉</div>
    <div id="rf-recruiter-badge" class="rf-recruiter-badge" style="display:none;">🔍 Recruiter</div>
    <div style="font-size: 1.5rem; font-weight: 700; color: var(--md-primary-fg-color, #1a1a2e); margin-bottom: 0.5rem;">
      Great, I have just the guy for you!
    </div>
    <img class="rf-photo" id="rf-photo" src="" alt="Reed Sutliff" onerror="this.style.display='none'">
    <div style="font-size: 1.3rem; font-weight: 600;">Reed Sutliff</div>
    <div style="color: var(--md-default-fg-color--light, #666); margin-bottom: 1rem;">
      Senior Software Engineer · Columbus, OH
    </div>
    <div class="rf-highlight" id="rf-match-note"></div>
    <div style="margin: 1.5rem 0;" id="rf-dl-section">
      <a class="rf-final-btn primary" id="rf-dl-btn" href="">📄 Download My Resume</a>
      <a class="rf-final-btn ghost" id="rf-dl-btn-anon" href="" style="display:none;">📄 Download Anonymized Version (for submission)</a>
      <br>
      <a class="rf-final-btn secondary" href="/resume/">🎲 Try a Different Path</a>
    </div>
    <div class="rf-contact" id="rf-contact-section">
      📧 <a href="mailto:sutliff.reed@gmail.com">sutliff.reed@gmail.com</a><br>
      🔗 <a href="https://linkedin.com/in/reed-sutliff-21213b114/">linkedin.com/in/reed-sutliff-21213b114</a><br>
      🌐 <a href="https://ffilt.us">ffilt.us</a>
    </div>
  </div>
  <div class="rf-path-note" id="rf-path-note"></div>
</div>

</div>

<script src="/assets/resume/interactive.js" defer></script>
