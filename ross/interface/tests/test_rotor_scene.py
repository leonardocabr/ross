# -*- coding: utf-8 -*-
"""The scene the 3D view draws, held against the rotor ROSS built.

`domain/rotor_scene.py` is the only place the 3D view learns where things are
and how big they are. Every claim it makes is checked here against ROSS itself
-- `nodes_pos`, the element objects, `DiskElement.from_geometry` -- and not
against numbers written in this file, because a scene that agrees with itself
and not with ROSS would draw a rotor nobody computed.
"""

import json
import math
import os
import sys

import pytest

ross = pytest.importorskip("ross", reason="requires ROSS installed")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from ross.interface.domain.rotor_builder import assemble_rotor  # noqa: E402
from ross.interface.domain.rotor_scene import (  # noqa: E402
    STEEL_DENSITY,
    describe_scene,
    equivalent_disk,
)

STEEL = {"name": "Steel", "rho": "7810", "E": "211e9", "G_s": "81.2e9"}
CATEGORIES = (
    "shafts",
    "couplings",
    "disks",
    "gears",
    "bearings",
    "seals",
    "pointmasses",
)


def shaft(**extra):
    """A 250 mm shaft element of 50 mm, in the screen's units (millimetres)."""
    return dict({"L": "250", "idl": "0", "odl": "50", "material": "Steel"}, **extra)


def project(**categories):
    built = {"materials": [dict(STEEL)], "shafts": [shaft() for _ in range(3)]}
    for category in CATEGORIES:
        built.setdefault(category, [])
    built["bearings"] = [
        {"element_type": "BASIC", "n": "0", "kxx": "1e6", "cxx": "0"},
        {"element_type": "BASIC", "n": "3", "kxx": "1e6", "cxx": "0"},
    ]
    built.update(categories)
    return built


def scene_of(built):
    assembled = assemble_rotor(built)
    return assembled, describe_scene(assembled)


# --- positions and units come from ROSS ---------------------------------------


def test_the_nodes_are_where_ross_puts_them():
    assembled, scene = scene_of(project())
    rotor = assembled.rotor
    assert scene["kind"] == "rotor"
    assert [n["n"] for n in scene["nodes"]] == [int(n) for n in rotor.nodes]
    assert [n["z"] for n in scene["nodes"]] == pytest.approx(list(rotor.nodes_pos))
    assert scene["length"] == pytest.approx(float(rotor.L))


def test_a_shaft_arrives_in_metres_whatever_unit_the_form_used():
    """The form says 250 and 50 (millimetres by default); the scene says 0.25
    and 0.05. It is ROSS that converted, which is why the scene is built here."""
    _, scene = scene_of(project())
    first = scene["shafts"][0]
    assert first["z1"] - first["z0"] == pytest.approx(0.25)
    assert first["odl"] == pytest.approx(0.05)
    assert first["idl"] == pytest.approx(0.0)


def test_a_tapered_shaft_keeps_both_ends():
    built = project(shafts=[shaft(odr="80", idr="10"), shaft(), shaft()])
    _, scene = scene_of(built)
    first = scene["shafts"][0]
    assert (first["odl"], first["odr"]) == pytest.approx((0.05, 0.08))
    assert (first["idl"], first["idr"]) == pytest.approx((0.0, 0.01))


def test_a_coupling_spans_its_two_nodes():
    """A `CouplingElement` is not a thing at a node: it occupies a span, like
    a shaft element -- the prototype drew it as a disk at one node."""
    built = project(
        couplings=[
            {
                "n": "3",
                "m_l": "1",
                "m_r": "1",
                "Ip_l": "0.01",
                "Ip_r": "0.01",
                "kt_x": "1e6",
                "kt_y": "1e6",
                "kt_z": "1e5",
                "kr_x": "1e3",
                "kr_y": "1e3",
                "kr_z": "1e3",
                "L": "100",
            }
        ]
    )
    built["bearings"][1]["n"] = "4"
    assembled, scene = scene_of(built)
    coupling = scene["couplings"][0]
    assert coupling["n"] == 3
    assert coupling["z1"] - coupling["z0"] == pytest.approx(0.1)
    assert coupling["z0"] == pytest.approx(0.75)


# --- each part knows its row ------------------------------------------------------


def test_every_part_carries_the_position_of_its_row():
    """The rows are deliberately out of node order: `Rotor` sorts by node, so a
    scene read back from the rotor's own lists would hand the click on the
    first bearing to the second row."""
    built = project(
        disks=[
            {"n": "2", "m": "10", "Ip": "0.1", "Id": "0.05", "tag": "D_two"},
            {"n": "1", "m": "10", "Ip": "0.1", "Id": "0.05", "tag": "D_one"},
        ],
        bearings=[
            {
                "element_type": "BASIC",
                "n": "3",
                "kxx": "1e6",
                "cxx": "0",
                "tag": "B_end",
            },
            {
                "element_type": "BASIC",
                "n": "0",
                "kxx": "1e6",
                "cxx": "0",
                "tag": "B_start",
            },
        ],
        pointmasses=[{"n": "2", "m": "1", "tag": "P"}],
    )
    for i, row in enumerate(built["shafts"]):
        row["tag"] = "S%d" % i
    _, scene = scene_of(built)

    for category in ("shafts", "disks", "bearings", "pointmasses"):
        tags = [row["tag"] for row in built[category]]
        drawn = sorted(scene[category], key=lambda part: part["index"])
        assert [part["tag"] for part in drawn] == tags, category
        assert [part["index"] for part in drawn] == list(range(len(tags))), category

    # ... and the node of each part is the node of its row, not of its place.
    assert scene["bearings"][0]["n"] == 3 and scene["bearings"][0]["tag"] == "B_end"


# --- what has no shape in ROSS -------------------------------------------------------


def test_the_equivalent_disk_is_the_inverse_of_rosss_from_geometry():
    """Decided with Leonardo: a disk is drawn as the steel disk with its mass
    and polar inertia. Built from a real geometry, it has to give that
    geometry back -- bored to the shaft it sits on."""
    real = ross.DiskElement.from_geometry(
        n=1, material=ross.materials.steel, width=0.04, i_d=0.05, o_d=0.26
    )
    back = equivalent_disk(real.m, real.Ip, bore_radius=0.025)
    assert back["bored"] is True
    assert back["exact"] is False
    assert back["outer_radius"] == pytest.approx(0.13, rel=1e-9)
    assert back["inner_radius"] == pytest.approx(0.025)
    assert back["width"] == pytest.approx(0.04, rel=1e-9)
    assert STEEL_DENSITY == pytest.approx(float(ross.materials.steel.rho))


def test_a_disk_in_the_scene_is_sized_from_its_own_row_and_its_shaft():
    real = ross.DiskElement.from_geometry(
        n=1, material=ross.materials.steel, width=0.04, i_d=0.05, o_d=0.26
    )
    built = project(
        disks=[
            {
                "n": "1",
                "m": repr(float(real.m)),
                "Ip": repr(float(real.Ip)),
                "Id": repr(float(real.Id)),
            }
        ]
    )
    _, scene = scene_of(built)
    disk = scene["disks"][0]
    assert disk["z"] == pytest.approx(0.25)
    assert disk["shape"]["exact"] is False
    assert disk["shape"]["outer_radius"] == pytest.approx(0.13, rel=1e-6)
    assert disk["shape"]["width"] == pytest.approx(0.04, rel=1e-6)


# --- a disk described by its dimensions (DiskElement.from_geometry) ----------------


def geometry_disk(**extra):
    """The example of ROSS's own docstring: 70 mm wide, 280 mm by 50 mm."""
    return dict(
        {
            "element_type": "Geometry",
            "n": "1",
            "width": "70",
            "o_d": "280",
            "i_d": "50",
            "material": "Steel",
        },
        **extra,
    )


def test_a_disk_from_its_dimensions_is_the_one_rosss_from_geometry_builds():
    """Same material as the project's (7810 kg/m^3, not ROSS's own steel),
    millimetres converted: the mass and both inertias are ROSS's."""
    assembled, _ = scene_of(project(disks=[geometry_disk()]))
    built = assembled.placed["disks"][0]
    material = ross.Material(name="Steel", rho=7810, E=211e9, G_s=81.2e9)
    real = ross.DiskElement.from_geometry(
        n=1, material=material, width=0.07, i_d=0.05, o_d=0.28
    )
    assert type(built) is ross.DiskElement
    for name in ("m", "Ip", "Id"):
        assert float(getattr(built, name)) == pytest.approx(
            float(getattr(real, name)), rel=1e-12
        ), name


def test_a_disk_from_its_dimensions_takes_the_unit_each_one_was_typed_in():
    mixed = geometry_disk(width="7", width_unit="cm", i_d="0.05", i_d_unit="m")
    assembled, _ = scene_of(project(disks=[mixed]))
    assert assembled.geometry["disks"] == [
        pytest.approx({"width": 0.07, "i_d": 0.05, "o_d": 0.28})
    ]


def test_a_disk_from_its_dimensions_is_drawn_with_them_and_says_so():
    """No equivalent disk for this one: the scene has the real dimensions,
    even though ROSS kept only m, Ip and Id."""
    _, scene = scene_of(
        project(
            disks=[geometry_disk(), {"n": "2", "m": "10", "Ip": "0.1", "Id": "0.05"}]
        )
    )
    exact, basic = scene["disks"]
    assert exact["shape"] == pytest.approx(
        {
            "outer_radius": 0.14,
            "inner_radius": 0.025,
            "width": 0.07,
            "bored": True,
            "exact": True,
        }
    )
    assert basic["shape"]["exact"] is False


@pytest.mark.parametrize(
    "row",
    [
        {"i_d": "300"},  # bore larger than the disk: negative mass in ROSS
        {"width": "0"},
        {"width": "-5"},
        {"i_d": "-1"},
        {"o_d": ""},
    ],
)
def test_a_disk_geometry_that_makes_no_disk_is_refused(row):
    """`from_geometry` takes whatever comes out: an inner diameter larger than
    the outer one builds a disk of negative mass without a word."""
    with pytest.raises(ValueError, match="disk"):
        assemble_rotor(project(disks=[geometry_disk(**row)]))


def test_a_disk_from_its_dimensions_with_no_material_is_of_the_default_steel():
    """No material is what the form's "Default (Steel)" means everywhere else."""
    row = geometry_disk()
    del row["material"]
    assembled, _ = scene_of(project(disks=[row]))
    real = ross.DiskElement.from_geometry(
        n=1, material=ross.materials.steel, width=0.07, i_d=0.05, o_d=0.28
    )
    assert float(assembled.placed["disks"][0].m) == pytest.approx(float(real.m))


def test_an_inertia_too_small_for_the_bore_gives_a_solid_disk_and_says_so():
    tiny = equivalent_disk(m=10.0, Ip=0.001, bore_radius=0.025)
    assert tiny["bored"] is False
    assert tiny["inner_radius"] == 0.0
    assert tiny["outer_radius"] == pytest.approx(math.sqrt(2 * 0.001 / 10.0))


@pytest.mark.parametrize("m, Ip", [(0, 0.1), (10, 0), (-1, 0.1), (None, 0.1)])
def test_no_disk_is_invented_for_a_mass_or_inertia_that_is_not_positive(m, Ip):
    """The screen draws a symbol instead. A disk made up to fill the gap would
    be the prototype's invented geometry again."""
    assert equivalent_disk(m, Ip, 0.025) is None


def test_a_gear_keeps_its_own_teeth_and_diameter():
    built = project(
        gears=[
            {
                "n": "1",
                "m": "5",
                "Ip": "0.04",
                "Id": "0.02",
                "n_teeth": "30",
                "pitch_diameter": "200",
            }
        ]
    )
    assembled, scene = scene_of(built)
    gear = scene["gears"][0]
    element = assembled.placed["gears"][0]
    assert gear["teeth"] == 30
    assert gear["pitch_radius"] == pytest.approx(float(element.pitch_diameter) / 2)
    assert gear["outer_radius"] == pytest.approx(float(element.addendum_radius))
    # No width in the row: the one that gives this mass to a steel ring of
    # these radii stands in for it, and says so.
    assert gear["width_is_equivalent"] is True
    ring = math.pi * (gear["outer_radius"] ** 2 - gear["bore_radius"] ** 2)
    assert gear["width"] * ring * STEEL_DENSITY == pytest.approx(5.0)


# --- link nodes ----------------------------------------------------------------------


def test_a_part_on_a_link_node_sits_under_the_node_that_links_to_it():
    """`nodes_pos` has no coordinate for a link node; ROSS's own 2D figure draws
    it under the bearing that names it in `n_link`."""
    built = project(
        bearings=[
            {
                "element_type": "BASIC",
                "n": "0",
                "kxx": "1e6",
                "cxx": "0",
                "n_link": "4",
            },
            {"element_type": "BASIC", "n": "4", "kxx": "1e6", "cxx": "0"},
            {"element_type": "BASIC", "n": "3", "kxx": "1e6", "cxx": "0"},
        ],
        pointmasses=[{"n": "4", "m": "1"}],
    )
    _, scene = scene_of(built)
    support = scene["bearings"][1]
    mass = scene["pointmasses"][0]
    assert (support["n"], support["link"], support["z"]) == (4, True, 0.0)
    assert (mass["link"], mass["z"]) == (True, 0.0)
    assert scene["bearings"][0]["n_link"] == 4


# --- MultiRotor ------------------------------------------------------------------------


def _gear_rotor(node):
    return project(
        gears=[
            {
                "n": str(node),
                "m": "5",
                "Ip": "0.04",
                "Id": "0.02",
                "n_teeth": "30",
                "pitch_diameter": "200",
            }
        ]
    )


def test_a_multirotor_is_two_lines_each_in_its_own_coordinates():
    built = {
        "isMultiRotor": True,
        "driving_rotor": _gear_rotor(2),
        "driven_rotor": _gear_rotor(1),
        "multi_params": {
            "coupled_nodes": "2, 1",
            "gear_mesh_stiffness": "1e8",
            "position": "below",
        },
    }
    assembled, scene = scene_of(built)
    assert scene["kind"] == "multirotor"
    assert scene["coupled_nodes"] == [2, 1]
    assert scene["position"] == "below"
    # ROSS's own axial offset, the one that lines the two gears up.
    assert scene["driven_offset"] == pytest.approx(float(assembled.rotor.dz_pos))
    assert scene["driven_offset"] == pytest.approx(0.25)
    for half in ("driving", "driven"):
        assert [n["n"] for n in scene[half]["nodes"]] == [0, 1, 2, 3]
    # The driven line's parts keep their own numbering: ROSS renumbers the
    # driven rotor inside the MultiRotor, and the rows on screen do not.
    assert scene["driven"]["gears"][0]["n"] == 1


def test_each_half_of_a_multirotor_keeps_the_dimensions_of_its_own_disks():
    driven = _gear_rotor(1)
    driven["disks"] = [geometry_disk(n="2")]
    built = {
        "isMultiRotor": True,
        "driving_rotor": _gear_rotor(2),
        "driven_rotor": driven,
        "multi_params": {"coupled_nodes": "2, 1", "gear_mesh_stiffness": "1e8"},
    }
    _, scene = scene_of(built)
    assert scene["driving"]["disks"] == []
    assert scene["driven"]["disks"][0]["shape"]["exact"] is True
    assert scene["driven"]["disks"][0]["shape"]["outer_radius"] == pytest.approx(0.14)


# --- what reaches the screen -------------------------------------------------------------


def test_the_scene_is_plain_json():
    """numpy scalars do not serialise, and NaN is not JSON. Both have to have
    been turned into plain numbers or None by the time the route answers."""
    _, scene = scene_of(
        project(
            disks=[{"n": "1", "m": "10", "Ip": "0.1", "Id": "0.05"}],
            gears=[
                {
                    "n": "2",
                    "m": "5",
                    "Ip": "0.04",
                    "Id": "0.02",
                    "n_teeth": "30",
                    "pitch_diameter": "200",
                }
            ],
        )
    )
    json.dumps(scene, allow_nan=False)


def test_the_route_answers_the_scene_with_the_figure():
    from ross.interface.api.security import SESSION_TOKEN
    from ross.interface.app import app

    app.config["TESTING"] = True
    with app.test_client() as client:
        response = client.post(
            "/build_rotor",
            json={"project": project()},
            headers={"X-ROSS-Token": SESSION_TOKEN},
        )
    assert response.status_code == 200
    body = response.get_json()
    assert "plot_json" in body
    assert body["scene"]["kind"] == "rotor"
    assert len(body["scene"]["shafts"]) == 3
