import { describe, it, expect } from "vitest";
import {
  stripScriptTags,
  stripAllHtml,
  normalizeWhitespace,
  sanitizeText,
  sanitizeRichText,
} from "../lib/sanitize";

describe("stripScriptTags", () => {
  it("removes <script>...</script> blocks", () => {
    const input = 'Hello <script>alert("xss")</script> World';
    expect(stripScriptTags(input)).toBe("Hello  World");
  });

  it("removes self-closing <script/> tags", () => {
    const input = '<script src="evil.js"/> content';
    expect(stripScriptTags(input)).toBe(" content");
  });

  it("removes script tags with attributes", () => {
    const input = '<script type="text/javascript" src="bad.js"></script>text';
    expect(stripScriptTags(input)).toBe("text");
  });

  it("removes multiline script blocks", () => {
    const input = "before<script>\n  malicious\n  code\n</script>after";
    expect(stripScriptTags(input)).toBe("beforeafter");
  });

  it("removes event handler attributes", () => {
    const input = '<button onclick="alert(1)">Click</button>';
    expect(stripScriptTags(input)).toBe('<button>Click</button>');
  });

  it("removes multiple event handler types", () => {
    const input = '<img src="x" onerror="evil()" onload="bad()" />';
    expect(stripScriptTags(input)).toBe('<img src="x" />');
  });

  it("removes event handlers with single quotes", () => {
    const input = "<div onclick='evil()'>text</div>";
    expect(stripScriptTags(input)).toBe("<div>text</div>");
  });

  it("removes javascript: in href attributes", () => {
    const input = '<a href="javascript:void(0)">link</a>';
    expect(stripScriptTags(input)).toBe('<a>link</a>');
  });

  it("removes javascript: in action attributes", () => {
    const input = '<form action="javascript:alert(1)">submit</form>';
    expect(stripScriptTags(input)).toBe('<form>submit</form>');
  });

  it("removes data: in href attributes", () => {
    const input = '<a href="data:text/html,<script>alert(1)</script>">link</a>';
    expect(stripScriptTags(input)).toBe('<a>link</a>');
  });

  it("removes data: in src attributes", () => {
    const input = '<img src="data:image/svg+xml,<script>alert(1)</script>" />';
    expect(stripScriptTags(input)).toBe('<img />');
  });

  it("leaves normal HTML attributes intact", () => {
    const input = '<p class="greeting" style="color: red">Hello</p>';
    expect(stripScriptTags(input)).toBe('<p class="greeting" style="color: red">Hello</p>');
  });

  it("handles empty string", () => {
    expect(stripScriptTags("")).toBe("");
  });

  it("handles string with no dangerous content", () => {
    const input = "Hello, this is a normal message.";
    expect(stripScriptTags(input)).toBe(input);
  });
});

describe("stripAllHtml", () => {
  it("removes all HTML tags", () => {
    const input = "<p>Hello <b>world</b></p>";
    expect(stripAllHtml(input)).toBe("Hello world");
  });

  it("removes script tags and all HTML", () => {
    const input = '<div><script>evil()</script>text</div>';
    expect(stripAllHtml(input)).toBe("text");
  });

  it("removes event handlers and all tags", () => {
    const input = '<img src="x" onerror="evil()">hello</img>';
    expect(stripAllHtml(input)).toBe("hello");
  });

  it("handles nested tags", () => {
    const input = "<div><span><a href='test'>link</a></span></div>";
    expect(stripAllHtml(input)).toBe("link");
  });

  it("removes self-closing tags", () => {
    const input = "before<br/>after";
    expect(stripAllHtml(input)).toBe("beforeafter");
  });

  it("returns empty string when content is only tags", () => {
    const input = "<div><span></span></div>";
    expect(stripAllHtml(input)).toBe("");
  });
});

describe("normalizeWhitespace", () => {
  it("collapses multiple spaces", () => {
    expect(normalizeWhitespace("hello    world")).toBe("hello world");
  });

  it("collapses newlines into single space", () => {
    expect(normalizeWhitespace("line1\nline2\nline3")).toBe("line1 line2 line3");
  });

  it("collapses tabs and mixed whitespace", () => {
    expect(normalizeWhitespace("a\t\tb   c")).toBe("a b c");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeWhitespace("  hello world  ")).toBe("hello world");
  });

  it("handles empty string", () => {
    expect(normalizeWhitespace("")).toBe("");
  });

  it("handles string with only whitespace", () => {
    expect(normalizeWhitespace("   \n  \t  ")).toBe("");
  });
});

describe("sanitizeText", () => {
  it("strips HTML and normalizes whitespace", () => {
    const input = "  <b>Hello</b>   <script>evil()</script>  ";
    expect(sanitizeText(input)).toBe("Hello");
  });

  it("strips event handlers and normalizes", () => {
    const input = '<img src="x" onerror="evil">  text  ';
    expect(sanitizeText(input)).toBe("text");
  });

  it("preserves normal text content", () => {
    const input = "  Normal text with   extra spaces  ";
    expect(sanitizeText(input)).toBe("Normal text with extra spaces");
  });
});

describe("sanitizeRichText", () => {
  it("strips script tags but keeps basic HTML", () => {
    const input = '<p>Hello <b>world</b><script>evil()</script></p>';
    expect(sanitizeRichText(input)).toBe('<p>Hello <b>world</b></p>');
  });

  it("strips event handlers but keeps HTML structure", () => {
    const input = '<button onclick="alert(1)">Click</button>';
    expect(sanitizeRichText(input)).toBe('<button>Click</button>');
  });

  it("trims leading/trailing whitespace", () => {
    const input = "  <p>hello</p>  ";
    expect(sanitizeRichText(input)).toBe("<p>hello</p>");
  });
});
