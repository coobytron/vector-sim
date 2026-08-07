import type { EnvironmentFieldSampler, FieldSourceRuntime } from '../fields/fieldSampler';
import type { FieldSample, Vec3 } from '../fields/types';

export interface FieldPanelController {
  refresh(sample: FieldSample, position: Vec3): void;
  dispose(): void;
}

function channelSummary(source: FieldSourceRuntime): string {
  const channels: string[] = [];
  if (source.strength !== 0) {
    channels.push(
      `${source.strength > 0 ? 'food' : 'kill'} ${source.strength.toFixed(2)} @ ${source.rangeMeters.toFixed(2)} m`,
    );
  }
  if (source.obstacle) channels.push('obstacle');
  if (source.shelter > 0) channels.push(`shelter ${source.shelter.toFixed(2)}`);
  if (source.habitat.some((value) => value !== 0)) {
    channels.push(`habitat ${source.habitat.map((value) => value.toFixed(2)).join('/')}`);
  }
  if (source.flow.some((value) => value !== 0)) {
    channels.push(`flow ${source.flow.map((value) => value.toFixed(2)).join('/')} m/s`);
  }
  if (source.capacity > 0) channels.push(`reserve ${source.capacity.toFixed(1)}`);
  return channels.length > 0 ? channels.join(' · ') : 'neutral';
}

/**
 * Field inspector and painting hook.
 *
 * Flipping a source's sign here proves the core claim of the field contract:
 * the same surface feeds or kills with no change in agent code.
 */
export function createFieldPanel(
  parent: HTMLElement,
  sampler: EnvironmentFieldSampler,
  onFieldsChanged: () => void,
): FieldPanelController {
  const panel = document.createElement('aside');
  panel.className = 'spectral-panel field-panel';
  panel.innerHTML = `
    <div class="spectral-panel__heading">
      <div>
        <p class="eyebrow">Signed field inspector</p>
        <h2>${sampler.environmentId}</h2>
      </div>
    </div>
    <ul class="field-sources" data-sources></ul>
    <dl class="spectral-values" data-probe>
      <div><dt>Probe</dt><dd data-probe-position>—</dd></div>
      <div><dt>Food / kill</dt><dd data-probe-effect>—</dd></div>
      <div><dt>Net effect</dt><dd data-probe-net>—</dd></div>
      <div><dt>Gradient</dt><dd data-probe-gradient>—</dd></div>
      <div><dt>Obstacle</dt><dd data-probe-obstacle>—</dd></div>
      <div><dt>Shelter / habitat</dt><dd data-probe-shelter>—</dd></div>
      <div><dt>Flow</dt><dd data-probe-flow>—</dd></div>
      <div><dt>Contact</dt><dd data-probe-contact>—</dd></div>
    </dl>
    <p class="spectral-stage">Blue is food, red is kill; brightness is falloff and arrows are the sampled gradient.</p>
  `;
  parent.append(panel);

  const list = panel.querySelector<HTMLElement>('[data-sources]');
  const probePosition = panel.querySelector<HTMLElement>('[data-probe-position]');
  const probeEffect = panel.querySelector<HTMLElement>('[data-probe-effect]');
  const probeNet = panel.querySelector<HTMLElement>('[data-probe-net]');
  const probeGradient = panel.querySelector<HTMLElement>('[data-probe-gradient]');
  const probeObstacle = panel.querySelector<HTMLElement>('[data-probe-obstacle]');
  const probeShelter = panel.querySelector<HTMLElement>('[data-probe-shelter]');
  const probeFlow = panel.querySelector<HTMLElement>('[data-probe-flow]');
  const probeContact = panel.querySelector<HTMLElement>('[data-probe-contact]');

  if (!list) throw new Error('Field panel failed to build its source list.');

  const renderSources = (): void => {
    list.innerHTML = '';
    for (const source of sampler.sources) {
      const item = document.createElement('li');
      item.className = 'field-source';
      const sign = source.strength > 0 ? 'food' : source.strength < 0 ? 'kill' : 'neutral';
      item.innerHTML = `
        <span class="field-source__sign" data-sign="${sign}" aria-hidden="true"></span>
        <span class="field-source__body">
          <strong>${source.id}</strong>
          <span>${channelSummary(source)}</span>
        </span>
      `;
      if (source.strength !== 0) {
        const flip = document.createElement('button');
        flip.type = 'button';
        flip.textContent = 'Flip sign';
        flip.addEventListener('click', () => {
          sampler.setStrength(source.id, -source.strength);
          renderSources();
          onFieldsChanged();
        });
        item.append(flip);
      }
      list.append(item);
    }
  };

  renderSources();

  return {
    refresh(sample: FieldSample, position: Vec3): void {
      const format = (value: number): string => value.toFixed(3);
      if (probePosition) {
        probePosition.textContent = position.map((value) => value.toFixed(2)).join(', ');
      }
      if (probeEffect) probeEffect.textContent = `${format(sample.food)} / ${format(sample.kill)}`;
      if (probeNet) probeNet.textContent = format(sample.effect);
      if (probeGradient) {
        probeGradient.textContent = `${format(sample.gradientX)}, ${format(sample.gradientY)}, ${format(sample.gradientZ)} · ${format(sample.gradientMagnitude)}`;
      }
      if (probeObstacle) {
        probeObstacle.textContent = `${format(sample.obstacleDistance)} m · n ${format(sample.obstacleNormalX)}, ${format(sample.obstacleNormalY)}, ${format(sample.obstacleNormalZ)}`;
      }
      if (probeShelter) {
        probeShelter.textContent = `${format(sample.shelter)} · ${format(sample.habitatA)}/${format(sample.habitatB)}/${format(sample.habitatC)}`;
      }
      if (probeFlow) {
        probeFlow.textContent = `${format(sample.flowX)}, ${format(sample.flowY)}, ${format(sample.flowZ)} m/s`;
      }
      if (probeContact) {
        const source = sampler.sources[sample.contactSourceIndex];
        probeContact.textContent = source
          ? `${source.id} · ${format(sample.contactX)}, ${format(sample.contactY)}, ${format(sample.contactZ)}`
          : 'none';
      }
    },
    dispose(): void {
      panel.remove();
    },
  };
}
