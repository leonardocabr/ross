# -*- coding: utf-8 -*-
"""The map between what the screen calls an element and the ROSS class.

Before Phase 1 this map existed in three different, incompatible shapes. The
guard that matters is the regression one: every registered class has to exist
in the installed ROSS, so that a rename in a library update shows up as a
failure here, and not as an empty form on the user's screen."""

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(ROOT)

import ross as rs

from ross.interface.domain import element_registry


def test_every_registered_class_exists_in_ross():
    """Regression guard: catches a class rename in a ROSS update -- or, for an
    alternative constructor such as DiskElement.from_geometry, a method
    rename."""
    for category, types in element_registry.ELEMENTS.items():
        for ui_type, constructor in types.items():
            assert element_registry.resolve_constructor(constructor) is not None, (
                f"{category}/{ui_type} points at rs.{constructor}, which does not exist"
            )


def test_registry_round_trip():
    for category, types in element_registry.ELEMENTS.items():
        for ui_type, constructor in types.items():
            assert element_registry.ross_constructor(category, ui_type) == constructor
            if "." in constructor:
                continue  # below: a file never names a classmethod
            assert element_registry.ross_class_name(category, ui_type) == constructor
            assert element_registry.ui_type_for_ross_class(constructor) == (
                category,
                ui_type,
            )


def test_a_disk_from_its_dimensions_is_still_a_disk_element():
    """The "Geometry" form calls DiskElement.from_geometry, and what comes out
    is a DiskElement: the class is the same, and a native ROSS file with a
    DiskElement in it comes back as the BASIC form, with m, Ip and Id -- ROSS
    does not keep the dimensions a disk was made from."""
    constructor = element_registry.ross_constructor("disks", "Geometry")
    assert constructor == "DiskElement.from_geometry"
    assert element_registry.resolve_constructor(constructor) == (
        rs.DiskElement.from_geometry
    )
    assert element_registry.ross_class_name("disks", "Geometry") == "DiskElement"
    assert element_registry.ui_type_for_ross_class("DiskElement") == ("disks", "BASIC")
    assert element_registry.ui_type_for_ross_class(constructor) is None


def test_an_unknown_constructor_resolves_to_nothing():
    assert element_registry.resolve_constructor("DiskElement.from_nowhere") is None
    assert element_registry.resolve_constructor("NoSuchElement") is None


def test_registry_falls_back_to_basic():
    assert element_registry.ross_class_name("bearings", "NaoExiste") == "BearingElement"
    assert element_registry.ross_class_name("seals", None) == "SealElement"
