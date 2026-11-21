"""pooltool's Mathavan collision models with one fix: no friction at a contact
whose slip is zero.

Copied from pooltool (https://github.com/ekiefl/pooltool, commit 9e819eb),
Copyright Evan Kiefl, Apache License 2.0 (LICENSES/pooltool-Apache-2.0.txt):
- pooltool/physics/resolve/ball_ball/frictional_mathavan/__init__.py (_collide_balls)
- pooltool/physics/resolve/ball_cushion/mathavan_2010/model.py

Modified (every change is marked "PATCH"):

1. Friction at a contact needs the
direction of slip there. When the slip is zero (a rolling ball on the cloth,
a ball at rest), upstream takes that direction from rounding noise: the
ball-cushion model from atan2 of two noise-level components (exactly zero
gives +x), the ball-ball model from noise / |noise| unless the magnitude is
exactly 0. One impulse step then rubs in an arbitrary direction, and a
change in the last bit of the input changes the result by up to ~1e-3 m/s,
so no independent implementation can reproduce it. Here a slip below
SLIP_EPS gets no friction for that step.

2. Ball-ball restitution ends with a partial step delivering about the
remaining work (as upstream's cushion model does), instead of whole steps.
Upstream's step size makes a frictionless collision end exactly on the
stopping threshold, so whether it takes one more step (0.2% more rebound
speed) is decided by rounding, in about half of all collisions.

3. Friction in a step is capped at the impulse that brings that contact's
slip to zero: the slip changes by at most 7/M per unit impulse between two
balls, and by 3.5/M at the cushion or the cloth. Upstream applies the full
coefficient, so once a slip reaches zero (sticking) it chatters across zero,
each step's direction set by rounding noise; in a straight shot with draw
this throws the object ball sideways by ~1e-4 m/s in a direction chosen by
noise.

Our engine (packages/physics/src/resolve/mathavan.ts) applies the same rules.

Used only to generate reference fixtures; nothing here ships.
"""

from __future__ import annotations

import math

import attrs
import numpy as np
from numba import jit
from numpy import array, dot, sqrt

from pooltool.objects.ball.datatypes import Ball, BallState
from pooltool.physics.resolve.ball_ball.frictional_mathavan import FrictionalMathavan
from pooltool.physics.resolve.ball_cushion.mathavan_2010.model import (
    Mathavan2010Circular,
    Mathavan2010Linear,
)
import pooltool.ptmath as ptmath
from pooltool.physics.utils import final_ball_motion_state

SLIP_EPS = 1e-9  # PATCH
INF = float("inf")
Z_LOC = array([0, 0, 1], dtype=np.float64)


# ---------------------------------------------------------------- ball-ball


@jit(nopython=True)
def _collide_balls(r_i, v_i, w_i, r_j, v_j, w_j, R, M, u_s1, u_s2, u_b, e_b, N):
    r_ij = r_j - r_i
    r_ij_mag_sqrd = dot(r_ij, r_ij)
    r_ij_mag = sqrt(r_ij_mag_sqrd)
    y_loc = r_ij / r_ij_mag
    x_loc = np.cross(y_loc, Z_LOC)
    G = np.vstack((x_loc, y_loc, Z_LOC))
    v_ix, v_iy = dot(v_i, x_loc), dot(v_i, y_loc)
    v_jx, v_jy = dot(v_j, x_loc), dot(v_j, y_loc)
    w_ix, w_iy, w_iz = dot(G, w_i)
    w_jx, w_jy, w_jz = dot(G, w_j)
    u_iR_x, u_iR_y = v_ix + R * w_iy, v_iy - R * w_ix
    u_jR_x, u_jR_y = v_jx + R * w_jy, v_jy - R * w_jx
    u_iR_xy_mag = sqrt(u_iR_x**2 + u_iR_y**2)
    u_jR_xy_mag = sqrt(u_jR_x**2 + u_jR_y**2)
    u_ijC_x = v_ix - v_jx - R * (w_iz + w_jz)
    u_ijC_z = R * (w_ix + w_jx)
    u_ijC_xz_mag = sqrt(u_ijC_x**2 + u_ijC_z**2)
    v_ijy = v_jy - v_iy
    deltaP = 0.5 * (1 + e_b) * M * abs(v_ijy) / N
    C = 5 / (2 * M * R)
    W_f = INF
    W_c = -1.0
    W = 0
    while v_ijy < 0 or W < W_f:
        # PATCH: the last restitution step delivers about the remaining work.
        # Upstream takes whole steps; its step size makes a frictionless
        # collision land exactly on W_f, so whether it takes one more step
        # (0.2% more rebound speed) is decided by rounding.
        dP = deltaP
        last = W_c >= 0 and W + deltaP * abs(v_ijy) > W_f
        if last:
            dP = (W_f - W) / abs(v_ijy)
        # PATCH: friction capped at what brings the slip to zero (7/M per unit).
        friction = min(u_b * dP, u_ijC_xz_mag * M / 7)
        if u_ijC_xz_mag < SLIP_EPS:  # PATCH: was 1e-16
            deltaP_1 = deltaP_2 = 0
            deltaP_ix = deltaP_iy = deltaP_jx = deltaP_jy = 0
        else:
            deltaP_1 = -friction * u_ijC_x / u_ijC_xz_mag
            if abs(u_ijC_z) < SLIP_EPS:  # PATCH: was 1e-16
                deltaP_2 = 0
                deltaP_ix = deltaP_iy = deltaP_jx = deltaP_jy = 0
            else:
                deltaP_2 = -friction * u_ijC_z / u_ijC_xz_mag
                if deltaP_2 > 0:
                    deltaP_ix = deltaP_iy = 0
                    if u_jR_xy_mag < SLIP_EPS:  # PATCH: was == 0
                        deltaP_jx = deltaP_jy = 0
                    else:
                        deltaP_jx = -u_s2 * (u_jR_x / u_jR_xy_mag) * deltaP_2
                        deltaP_jy = -u_s2 * (u_jR_y / u_jR_xy_mag) * deltaP_2
                else:
                    deltaP_jx = deltaP_jy = 0
                    if u_iR_xy_mag < SLIP_EPS:  # PATCH: was == 0
                        deltaP_ix = deltaP_iy = 0
                    else:
                        deltaP_ix = u_s1 * (u_iR_x / u_iR_xy_mag) * deltaP_2
                        deltaP_iy = u_s1 * (u_iR_y / u_iR_xy_mag) * deltaP_2
        deltaV_ix = (deltaP_1 + deltaP_ix) / M
        deltaV_iy = (-dP + deltaP_iy) / M
        deltaV_jx = (-deltaP_1 + deltaP_jx) / M
        deltaV_jy = (dP + deltaP_jy) / M
        deltaOm_ix = C * (deltaP_2 + deltaP_iy)
        deltaOm_iy = C * (-deltaP_ix)
        deltaOm_iz = C * (-deltaP_1)
        deltaOm_j = C * array([(deltaP_2 + deltaP_jy), (-deltaP_jx), (-deltaP_1)])
        v_ix += deltaV_ix
        v_jx += deltaV_jx
        v_iy += deltaV_iy
        v_jy += deltaV_jy
        w_ix += deltaOm_ix
        w_iy += deltaOm_iy
        w_iz += deltaOm_iz
        w_jx += deltaOm_j[0]
        w_jy += deltaOm_j[1]
        w_jz += deltaOm_j[2]
        u_iR_x, u_iR_y = v_ix + R * w_iy, v_iy - R * w_ix
        u_jR_x, u_jR_y = v_jx + R * w_jy, v_jy - R * w_jx
        u_iR_xy_mag = sqrt(u_iR_x**2 + u_iR_y**2)
        u_jR_xy_mag = sqrt(u_jR_x**2 + u_jR_y**2)
        u_ijC_x = v_ix - v_jx - R * (w_iz + w_jz)
        u_ijC_z = R * (w_ix + w_jx)
        u_ijC_xz_mag = sqrt(u_ijC_x**2 + u_ijC_z**2)
        v_ijy0 = v_ijy
        v_ijy = v_jy - v_iy
        W += 0.5 * dP * abs(v_ijy0 + v_ijy)
        if W_c < 0 and v_ijy > 0:
            W_c = W
            W_f = (1 + e_b**2) * W_c
        if last:
            break
    v_i = array((v_ix, v_iy, 0))
    v_j = array((v_jx, v_jy, 0))
    w_i = array((w_ix, w_iy, w_iz))
    w_j = array((w_jx, w_jy, w_jz))
    G_T = G.T
    return dot(G_T, v_i), dot(G_T, w_i), dot(G_T, v_j), dot(G_T, w_j)


@attrs.define
class PatchedFrictionalMathavan(FrictionalMathavan):
    def solve(self, ball1: Ball, ball2: Ball) -> tuple[Ball, Ball]:
        rvw1, rvw2 = ball1.state.rvw.copy(), ball2.state.rvw.copy()
        v_i1, w_i1, v_j1, w_j1 = _collide_balls(
            rvw1[0], rvw1[1], rvw1[2], rvw2[0], rvw2[1], rvw2[2],
            ball1.params.R, ball1.params.m, ball1.params.u_s, ball2.params.u_s,
            self.friction.calculate_friction(ball1, ball2),
            (ball1.params.e_b + ball2.params.e_b) / 2, self.num_iterations,
        )
        rvw1[1, :2] = v_i1[:2]
        rvw2[1, :2] = v_j1[:2]
        rvw1[2] = w_i1
        rvw2[2] = w_j1
        ball1.state = BallState(rvw1, final_ball_motion_state(rvw1, ball1.params.R))
        ball2.state = BallState(rvw2, final_ball_motion_state(rvw2, ball2.params.R))
        return ball1, ball2


# ---------------------------------------------------------------- ball-cushion


@jit(nopython=True)
def slip_angles(R, sin_theta, cos_theta, vx, vy, omega_x, omega_y, omega_z):
    v_xI = vx + omega_y * R * sin_theta - omega_z * R * cos_theta
    v_yI = -vy * sin_theta + omega_x * R
    v_xC = vx - omega_y * R
    v_yC = vy + omega_x * R
    slip_angle = math.atan2(v_yI, v_xI)
    if slip_angle < 0:
        slip_angle += 2 * math.pi
    slip_angle_prime = math.atan2(v_yC, v_xC)
    if slip_angle_prime < 0:
        slip_angle_prime += 2 * math.pi
    # PATCH: no direction (NaN, meaning no friction) where there is no slip.
    slip_I = math.sqrt(v_xI**2 + v_yI**2)
    slip_C = math.sqrt(v_xC**2 + v_yC**2)
    if slip_I < SLIP_EPS:
        slip_angle = math.nan
    if slip_C < SLIP_EPS:
        slip_angle_prime = math.nan
    return slip_angle, slip_angle_prime, slip_I, slip_C


@jit(nopython=True)
def step(M, R, mu_s, mu_w, sin_theta, cos_theta, vx, vy, omega_x, omega_y, omega_z,
         slip, delta_p):
    slip_angle, slip_angle_prime, slip_I, slip_C = slip
    # PATCH: a NaN angle means no friction at that contact.
    if math.isnan(slip_angle):
        mu_w = 0.0
        slip_angle = 0.0
    if math.isnan(slip_angle_prime):
        mu_s = 0.0
        slip_angle_prime = 0.0
    # PATCH: friction capped at what brings each contact's slip to zero
    # (3.5/M per unit impulse). Upstream chatters across zero slip with each
    # step's direction set by rounding noise.
    mu_w = min(mu_w, slip_I * M / (3.5 * delta_p))
    mu_s = min(mu_s, slip_C * M / (3.5 * delta_p * (sin_theta + mu_w * math.sin(slip_angle) * cos_theta)))
    vx_new = vx - (
        (1 / M)
        * (mu_w * math.cos(slip_angle)
           + mu_s * math.cos(slip_angle_prime) * (sin_theta + mu_w * math.sin(slip_angle) * cos_theta))
        * delta_p
    )
    vy_new = vy - (
        (1 / M)
        * (cos_theta - mu_w * sin_theta * math.sin(slip_angle)
           + mu_s * math.sin(slip_angle_prime) * (sin_theta + mu_w * math.sin(slip_angle) * cos_theta))
        * delta_p
    )
    factor = 5 / (2 * M * R)
    omega_x_new = omega_x + (
        -factor
        * (mu_w * math.sin(slip_angle)
           + mu_s * math.sin(slip_angle_prime) * (sin_theta + mu_w * math.sin(slip_angle) * cos_theta))
        * delta_p
    )
    omega_y_new = omega_y + (
        -factor
        * (mu_w * math.cos(slip_angle) * sin_theta
           - mu_s * math.cos(slip_angle_prime) * (sin_theta + mu_w * math.sin(slip_angle) * cos_theta))
        * delta_p
    )
    omega_z_new = omega_z + (factor * (mu_w * math.cos(slip_angle) * cos_theta) * delta_p)
    return vx_new, vy_new, omega_x_new, omega_y_new, omega_z_new


@jit(nopython=True)
def solve(M, R, h, ee, mu_s, mu_w, vx, vy, omega_x, omega_y, omega_z, max_steps, delta_p0):
    sin_theta = (h - R) / R
    cos_theta = np.sqrt(1 - sin_theta**2)

    # Compression (upstream compression_phase).
    WzI = 0.0
    step_count = 0
    delta_p = max((M * vy) / max_steps, delta_p0)
    while vy > 0:
        sl = slip_angles(R, sin_theta, cos_theta, vx, vy, omega_x, omega_y, omega_z)
        nx = step(M, R, mu_s, mu_w, sin_theta, cos_theta, vx, vy, omega_x, omega_y, omega_z, sl, delta_p)
        if vy > 0 and nx[1] <= 0:
            refine = delta_p
            for _ in range(8):
                refine /= 2
                sl = slip_angles(R, sin_theta, cos_theta, vx, vy, omega_x, omega_y, omega_z)
                t = step(M, R, mu_s, mu_w, sin_theta, cos_theta, vx, vy, omega_x, omega_y, omega_z, sl, refine)
                if t[1] <= 0:
                    continue
                vx, vy, omega_x, omega_y, omega_z = t
                WzI += refine * abs(vy) * cos_theta
            break
        vx, vy, omega_x, omega_y, omega_z = nx
        WzI += delta_p * abs(vy) * cos_theta
        step_count += 1
        if step_count > 10 * max_steps:
            raise RuntimeError("Solution not found in compression phase")

    # Restitution (upstream restitution_phase).
    target = ee**2 * WzI
    W = 0.0
    step_count = 0
    delta_p = max(target / max_steps, delta_p0)
    while W < target:
        sl = slip_angles(R, sin_theta, cos_theta, vx, vy, omega_x, omega_y, omega_z)
        dW = delta_p * abs(vy) * cos_theta
        if W + dW > target:
            last = (target - W) / (abs(vy) * cos_theta)
            return step(M, R, mu_s, mu_w, sin_theta, cos_theta, vx, vy, omega_x, omega_y, omega_z, sl, last)
        vx, vy, omega_x, omega_y, omega_z = step(
            M, R, mu_s, mu_w, sin_theta, cos_theta, vx, vy, omega_x, omega_y, omega_z, sl, delta_p)
        W += delta_p * abs(vy) * cos_theta
        step_count += 1
        if step_count > 10 * max_steps:
            raise RuntimeError("Solution not found in restitution phase")
    return vx, vy, omega_x, omega_y, omega_z


def solve_mathavan(ball, cushion, max_steps, delta_p):
    """Upstream solve_mathavan, calling the patched solve."""
    rvw = ball.state.rvw
    normal = -cushion.get_normal_xy(ball.xyz)
    psi = ptmath.angle(normal)
    angle_to_rotate = (math.pi / 2) - psi
    rvw_R = ptmath.coordinate_rotation(rvw.T, angle_to_rotate).T
    out = solve(ball.params.m, ball.params.R, cushion.height, ball.params.e_c, ball.params.u_s,
                ball.params.f_c, rvw_R[1, 0], rvw_R[1, 1], rvw_R[2, 0], rvw_R[2, 1], rvw_R[2, 2],
                max_steps, delta_p)
    rvw_R[1, 0], rvw_R[1, 1], rvw_R[2, 0], rvw_R[2, 1], rvw_R[2, 2] = out
    rvw_final = ptmath.coordinate_rotation(rvw_R.T, -angle_to_rotate).T
    ball.state = BallState(rvw_final, final_ball_motion_state(rvw_final, ball.params.R))
    return ball, cushion


@attrs.define
class PatchedMathavan2010Linear(Mathavan2010Linear):
    def solve(self, ball, cushion):
        return solve_mathavan(ball, cushion, self.max_steps, self.delta_p)


@attrs.define
class PatchedMathavan2010Circular(Mathavan2010Circular):
    def solve(self, ball, cushion):
        return solve_mathavan(ball, cushion, self.max_steps, self.delta_p)
