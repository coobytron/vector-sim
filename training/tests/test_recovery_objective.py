import pytest
import torch

from vector_nca.objectives import lesion_recovery_loss


class AffineRollout(torch.nn.Module):
    """Analytic counterexample: common translation cannot heal a lesion."""

    def __init__(self, scale=1.0, drift=0.25):
        super().__init__()
        self.scale = torch.nn.Parameter(torch.tensor(scale, dtype=torch.float64))
        self.drift = torch.nn.Parameter(torch.tensor(drift, dtype=torch.float64))

    def rollout(self, state, sensors, steps):
        for _ in range(steps):
            state = state * self.scale + self.drift
        return state


def fixture():
    seed = torch.ones((4, 2), dtype=torch.float64, requires_grad=True)
    mask = torch.tensor([False, True, True, False])
    return seed, torch.zeros_like(seed), mask


def test_shared_drift_has_zero_recovery_gradient():
    seed, sensors, mask = fixture()
    model = AffineRollout()
    loss = lesion_recovery_loss(model, seed, sensors, mask, 4, 0.75)
    loss.backward()
    assert loss.item() == pytest.approx(1.25)
    assert model.drift.grad.item() == pytest.approx(0.0, abs=1e-12)
    assert seed.grad is None  # Cannot game the loss by shrinking initial damage.

    # Reproduce v3's spurious incentive despite exactly the same forward loss.
    model.zero_grad()
    damaged = seed.detach().clone()
    damaged[mask] = 0
    intact = model.rollout(seed.detach(), sensors, 4).detach()
    difference = (model.rollout(damaged, sensors, 4) - intact)[mask]
    legacy = difference.square().mean() + torch.relu(difference.abs().mean() - 0.75)
    legacy.backward()
    assert legacy.item() == pytest.approx(loss.item())
    assert abs(model.drift.grad.item()) > 1.0


def test_contraction_gradient_matches_finite_difference_and_reduces_error():
    seed, sensors, mask = fixture()
    model = AffineRollout(scale=0.95)
    loss = lesion_recovery_loss(model, seed, sensors, mask, 4, 0.75)
    loss.backward()
    analytic = model.scale.grad.item()
    epsilon = 1e-6
    plus = lesion_recovery_loss(AffineRollout(scale=0.95 + epsilon), seed, sensors, mask, 4, 0.75)
    minus = lesion_recovery_loss(AffineRollout(scale=0.95 - epsilon), seed, sensors, mask, 4, 0.75)
    assert analytic == pytest.approx((plus.item() - minus.item()) / (2 * epsilon), rel=1e-6)
    assert analytic > 0
    torch.optim.SGD(model.parameters(), lr=0.01).step()
    assert lesion_recovery_loss(model, seed, sensors, mask, 4, 0.75).item() < loss.item()
