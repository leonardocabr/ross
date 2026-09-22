# -*- coding: utf-8 -*-
"""The name a material has to have for ROSS to accept it.

`rs.Material` refuses any space in the name (`materials.py`: ``if " " in name:
raise ValueError("Spaces are not allowed in Material name")``). The form lets a
person type "Stainless Steel", and before this module the rotor then failed to
build, far from the field that caused it.

The screen now writes the name the way ROSS wants it when the material is saved
(`frontend/core/material_names.js`). This is the same rule on the server's side,
for the projects saved before that: a rotor stored in the browser or in a file
with "Stainless Steel" in it must still build, and its shafts, which name the
material the same way, must still find it. So the rule is applied on both ends
of the reference -- the material's name and the element's `material` -- and the
two meet.

Runs of whitespace become one underscore, and the ends are trimmed:
"Stainless  Steel " is "Stainless_Steel". The cases both sides are held to live
in `tests/golden/material_names.json`.
"""


def ross_material_name(name):
    """The name as ROSS accepts it."""
    return "_".join(str(name).split())


def material_key(name):
    """How a reference to a material is matched: ROSS's name, without case."""
    return ross_material_name(name).lower()
