# -*- coding: utf-8 -*-
"""The MultiRotor's gear mesh damping, from ROSS #1427.

`rs.MultiRotor(..., mesh_damping_ratio=ζ)` damps the gear mesh with
`c_m = 2 ζ sqrt(k_m M_eq)`. Dimensionless, so it goes to ROSS as typed. Blank
is ROSS's own default (no mesh damping), and a MultiRotor saved before the
field existed has no key at all and must build exactly as it did.
"""

import ast
import os
import sys

import numpy as np
import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from ross.interface.domain.python_export import _multi_rotor_block  # noqa: E402
from ross.interface.domain.rotor_builder import assemble_rotor  # noqa: E402
from ross.interface.tests.test_rotor_scene import _gear_rotor  # noqa: E402


def train(**multi):
    return {
        "isMultiRotor": True,
        "driving_rotor": _gear_rotor(2),
        "driven_rotor": _gear_rotor(1),
        "multi_params": dict(
            {"coupled_nodes": "2, 1", "gear_mesh_stiffness": "1e8"}, **multi
        ),
    }


def damping_matrix(built):
    return assemble_rotor(built).rotor.C(0)


def test_the_ratio_reaches_ross():
    assert (
        assemble_rotor(train(mesh_damping_ratio="0.05")).rotor.mesh.damping_ratio
        == 0.05
    )


@pytest.mark.parametrize(
    "blank", [{}, {"mesh_damping_ratio": ""}, {"mesh_damping_ratio": " "}]
)
def test_blank_or_absent_is_ross_s_default_of_no_mesh_damping(blank):
    assert assemble_rotor(train(**blank)).rotor.mesh.damping_ratio == 0.0


def test_the_ratio_damps_the_coupled_system():
    undamped = damping_matrix(train())
    damped = damping_matrix(train(mesh_damping_ratio="0.05"))
    assert not np.allclose(undamped, damped)


def test_the_script_builds_the_same_mesh():
    block = _multi_rotor_block(
        {
            "coupled_nodes": "2, 1",
            "gear_mesh_stiffness": "1e8",
            "mesh_damping_ratio": "0.05",
        }
    )
    ast.parse(block)
    assert ", mesh_damping_ratio=0.05" in block


def test_the_script_leaves_a_blank_ratio_to_ross():
    assert "mesh_damping_ratio" not in _multi_rotor_block({"mesh_damping_ratio": ""})
    assert "mesh_damping_ratio" not in _multi_rotor_block({"coupled_nodes": "2, 1"})
