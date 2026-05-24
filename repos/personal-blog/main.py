import os
import shutil
import subprocess
from dotenv import load_dotenv
import glob
import os.path

_RESUME_BUILT = False

def _build_resume_assets():
    global _RESUME_BUILT
    if _RESUME_BUILT:
        return

    # 1. Compile TypeScript => JS
    ts_script = os.path.join(os.getcwd(), "resume", "scripts", "build-ts.py")
    if os.path.exists(ts_script):
        subprocess.run(["python3", ts_script], capture_output=True)

    # 2. Copy resume PDFs
    src_dir = os.path.join(os.getcwd(), "resume", "output")
    dst_dir = os.path.join(os.getcwd(), "docs", "assets", "resume")
    if os.path.exists(src_dir):
        os.makedirs(dst_dir, exist_ok=True)
        for pdf in glob.glob(os.path.join(src_dir, "*", "resume.pdf")):
            variant = os.path.basename(os.path.dirname(pdf))
            shutil.copy2(pdf, os.path.join(dst_dir, f"{variant}.pdf"))

    _RESUME_BUILT = True

def define_env(env):
    load_dotenv()
    _build_resume_assets()
    @env.macro
    def create_index(relative_path: str):
        docs_dir = os.path.join(os.getcwd(),"docs")
        target_path = os.path.join(docs_dir,relative_path)
        output = ""
        for file in glob.glob(target_path+os.sep+"*.md"):
            name = os.path.splitext(os.path.basename(file))[0]
            href = "/" + relative_path + "/" + name
            if(name == "index"):
                continue
            output = output + f"\n\n [{name}]({href})"
        return output
    @env.macro
    def format_text(text, start_line = 0,end_line = 20, indent = 1):
        lines = text.splitlines()
        output = []
        index = 0
        for line in lines:
            index = index + 1
            if index < start_line:
                continue
            if index > end_line:
                break
            output.append("\t" * indent + line)
        return "\n".join(output)