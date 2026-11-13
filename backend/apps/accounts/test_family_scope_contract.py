"""Contract: "the children of this login" has ONE definition.

``accounts.family.family_students`` decides what a family login sees (linked
children, its own profile, the siblings of its Family). A view that filters
``parents=user`` by hand silently drops the siblings, so new code must call
the rule instead. The allowlist holds the few places that ask a different
question on purpose (guardian links themselves, not visibility).
"""
import re
from pathlib import Path

APPS = Path(__file__).resolve().parents[1]
PATTERN = re.compile(r"filter\(\s*parents\s*=|parents\s*=\s*(request\.)?user\b")
ALLOWED = {
    'accounts/family.py',          # the rule itself
    'accounts/merge.py',           # moves guardian links between two accounts
    'accounts/student_delete.py',  # "is this login a guardian of another student?"
}


def test_no_hand_written_family_scoping():
    offenders = []
    for path in APPS.rglob('*.py'):
        rel = path.relative_to(APPS).as_posix()
        if rel in ALLOWED or '/migrations/' in rel or path.name.startswith('test_') or 'factories' in rel:
            continue
        for n, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
            code = line.split('#', 1)[0]
            if PATTERN.search(code):
                offenders.append(f'{rel}:{n}: {line.strip()}')
    assert not offenders, 'Use accounts.family.family_students(user):\n' + '\n'.join(offenders)
