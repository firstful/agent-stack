/**
 * templates.ts — document template definitions.
 *
 * Each template is a factory function that returns a `blocks: Block[]` array
 * ready to be inserted as the initial content of a new page.
 *
 * Templates available:
 *   - meeting-notes     free-form markdown note for a meeting; intro header
 *                        + agenda + attendees + notes + action items block
 *   - adr              Architecture Decision Record — problem, context,
 *                        decision, consequences, alternatives considered
 *   - postmortem       5-whys root-cause structure with metadata fields
 *   - okr              Objective-and-Key-Result structure with owners + status
 */
let _seq = 0;
function block(type, content, attrs = {}) {
    return {
        id: crypto.randomUUID(),
        pageId: "", // caller sets
        index: _seq++,
        children: [],
        type,
        content,
        authorId: "",
        createdAt: new Date(),
        updatedAt: null,
        deletedAt: null,
        yjsLogHash: null,
        attributes: attrs,
    };
}
function heading(content, level) {
    return block(level === 1 ? "heading" : level === 2 ? "heading2" : "heading3", content);
}
function h(text) { return heading(text, 1); }
function h2(text) { return heading(text, 2); }
function h3(text) { return heading(text, 3); }
function p(text) { return block("paragraph", text); }
function bullet(text) { return block("bulletList", text); }
function code(lang, text) { return block("codeBlock", text, { language: lang }); }
function divider() { return block("divider", ""); }
function quote(text) { return block("blockQuote", text); }
export const templates = {
    /**
     * meeting-notes — free-form agenda / notes / action item structure.
     */
    "meeting-notes": (meta = {}) => {
        _seq = 0;
        const title = meta.title ?? "Meeting Notes";
        const date = meta.date ?? new Date().toLocaleDateString();
        return [
            h(title),
            p(`Date: ${date}`),
            ...(meta.participants?.length ? [h2("Attendees"), bullet(meta.participants.join(", ")), divider()] : []),
            h2("Agenda"),
            bullet("(Add agenda item)"),
            divider(),
            h2("Notes"),
            p("(Start taking notes…)"),
            divider(),
            h2("Action Items"),
            bullet("(Add action item)"),
        ];
    },
    /**
     * adr — Architecture Decision Record.
     */
    "adr": (meta = {}) => {
        _seq = 0;
        const title = meta.title ?? "Architecture Decision Record";
        return [
            h(`ADR: ${title}`),
            divider(),
            h2("Status"),
            p("Proposed"),
            divider(),
            h2("Context"),
            p("(Describe the forces at play, including technological, political, social, and project local.)"),
            divider(),
            h2("Decision"),
            p("(State the decision clearly and concisely.)"),
            divider(),
            h2("Consequences"),
            p("(What becomes easier or more difficult because of this decision?)"),
            p("(Describe any new problems that are created.)"),
            divider(),
            h2("Alternatives Considered"),
            p("1. (First alternative)"),
            bullet("Why it was not chosen."),
            p("2. (Second alternative)"),
            bullet("Why it was not chosen."),
        ];
    },
    /**
     * postmortem — struct-simple root-cause template.
     */
    "postmortem": (meta = {}) => {
        _seq = 0;
        const title = meta.title ?? "Postmortem";
        return [
            h(title),
            divider(),
            h2("Summary"),
            p("(One-paragraph executive summary of the incident.)"),
            divider(),
            h2("Timeline"),
            p("(UTC timestamps and actions taken.)"),
            divider(),
            h2("Root Cause"),
            h3("5 Whys"),
            bullet("1. (Why did it happen?)"),
            bullet("   (Why?)"),
            bullet("      (Why?)"),
            bullet("         (Why?)"),
            bullet("            (Why root cause)"),
            divider(),
            h2("Impact"),
            bullet("(User impact — number of users affected.)"),
            bullet("(Duration of impact.)"),
            divider(),
            h2("Action Items"),
            p("| ID | Owner | Description | Severity |"),
            p("| -- | ----- | ----------- | -------- |"),
            p("| 1  | @todo  |              | Critical |"),
        ];
    },
    /**
     * okr — Objectives and Key Results template.
     */
    "okr": (meta = {}) => {
        _seq = 0;
        const title = meta.title ?? "OKR";
        const quarter = meta.quarter ?? `Q${Math.ceil((new Date().getMonth() + 1) / 3)} ${new Date().getFullYear()}`;
        return [
            h(title),
            p(`Period: ${quarter}`),
            divider(),
            h2("Objective 1"),
            p("(Write a crisp and inspiring objective.)"),
            h3("Key Results"),
            bullet("KR1: … — Owner: @todo — Status: On Track ⚡"),
            bullet("KR2: … — Owner: @todo — Status: At Risk 🔴"),
            bullet("KR3: … — Owner: @todo — Status: Off Track 🚫"),
            divider(),
            h2("Objective 2"),
            p("(Write a crisp and inspiring objective.)"),
            h3("Key Results"),
            bullet("KR1: … — Owner: @todo — Status: On Track ⚡"),
            bullet("KR2: … — Owner: @todo — Status: On Track ⚡"),
        ];
    },
};
/** Convenience: look up a template by name, return blocks array (or throw). */
export function getTemplate(name, meta) {
    return templates[name](meta);
}
//# sourceMappingURL=templates.js.map