# -*- coding: utf-8 -*-
"""A material named with spaces, from the form to ROSS and to the script.

`rs.Material` refuses a space in the name, and the form let a person type
"Stainless Steel": the rotor then failed to build. The screen now writes the
name the way ROSS wants it when the material is saved; the server applies the
same rule (domain/material_names.py) to projects saved before that, on both ends
of the reference -- the material and the shafts that name it.
"""

import copy
import json
import os
import sys

import pytest

ross = pytest.importorskip("ross", reason="requires ROSS installed")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from ross.interface.domain.concatenation import concatenated_project  # noqa: E402
from ross.interface.domain.material_names import ross_material_name  # noqa: E402
from ross.interface.domain.python_export import build_script  # noqa: E402
from ross.interface.domain.rotor_builder import build_rotor_from_ui  # noqa: E402

GOLDEN = os.path.join(ROOT, "tests", "golden", "material_names.json")

# A shaft whose material name is not found gets the *first* material of the
# list, silently (`rotor_builder.extract_kwargs`). So plain steel goes first,
# and the density tells a shaft that found its stainless apart from one that
# fell back.
STEEL = {"name": "Steel", "rho": "7810", "E": "211e9", "G_s": "81.2e9"}
STAINLESS = {"name": "Stainless Steel", "rho": "8000", "E": "193e9", "G_s": "77e9"}


def project(material_name="Stainless Steel", shaft_names="Stainless Steel"):
    """A rotor in the screen's format: two shafts of one material, a bearing."""
    return {
        "materials": [dict(STEEL), dict(STAINLESS, name=material_name)],
        "shafts": [
            {
                "element_type": "BASIC",
                "L": "250",
                "idl": "0",
                "odl": "50",
                "material": shaft_names,
            }
            for _ in range(2)
        ],
        "disks": [],
        "gears": [],
        "couplings": [],
        "seals": [],
        "bearings": [
            {"element_type": "BASIC", "n": "0", "kxx": "1e6", "cxx": "0"},
            {"element_type": "BASIC", "n": "2", "kxx": "1e6", "cxx": "0"},
        ],
        "pointmasses": [],
    }


def test_the_rule_matches_the_cases_the_screen_is_held_to():
    """The same file drives tests/js/test_material_names.js."""
    with open(GOLDEN, encoding="utf-8") as handle:
        cases = json.load(handle)["cases"]
    assert len(cases) > 5
    for typed, expected in cases:
        assert ross_material_name(typed) == expected, typed


def test_ross_still_refuses_the_space():
    """What justifies the rule. If ROSS starts accepting spaces, this says so."""
    with pytest.raises(ValueError, match="Spaces are not allowed"):
        ross.Material(name="Stainless Steel", rho=8000, E=193e9, G_s=77e9)


def test_a_project_saved_with_a_space_builds_and_its_shafts_find_the_material():
    rotor = build_rotor_from_ui(project())
    for shaft in rotor.shaft_elements:
        assert shaft.material.name == "Stainless_Steel"
        assert shaft.material.rho == pytest.approx(8000)


@pytest.mark.parametrize(
    "material_name, shaft_names",
    [("Stainless_Steel", "Stainless Steel"), ("Stainless Steel", "stainless_steel")],
)
def test_either_spelling_on_either_end_meets_the_other(material_name, shaft_names):
    """A material saved again from the form is underscored; a shaft saved before
    still says it with a space. The two must still meet."""
    rotor = build_rotor_from_ui(project(material_name, shaft_names))
    assert [s.material.rho for s in rotor.shaft_elements] == pytest.approx([8000, 8000])


def test_the_exported_script_uses_the_name_ross_accepts():
    script = build_script(project())
    assert "name='Stainless_Steel'" in script
    assert "'Stainless Steel'" not in script
    # ... and the shafts look it up under the same key it is stored under.
    assert script.count("'stainless_steel'") >= 3


def test_concatenation_sees_the_two_spellings_as_one_material():
    """Same properties, one spelled with a space: one material, not a `_R1`."""
    first = project("Stainless Steel", "Stainless Steel")
    second = project("Stainless_Steel", "Stainless_Steel")
    merged = concatenated_project(first, copy.deepcopy(second))
    assert len(merged["materials"]) == 2, [m["name"] for m in merged["materials"]]
    build_rotor_from_ui(merged)
