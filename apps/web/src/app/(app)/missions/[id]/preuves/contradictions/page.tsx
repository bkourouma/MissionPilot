import Link from "next/link";
import type { Metadata } from "next";
import { BadgeSolidite } from "../../../../../../components/preuves/BadgeSolidite";
import { PreuveLieeCarte } from "../../../../../../components/preuves/PreuveLieeCarte";
import { BadgeStatut } from "../../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../../components/ui/Carte";
import { EtatErreur, EtatVide } from "../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import { obtenirT } from "../../../../../../lib/i18n/serveur";
import { chargerMission } from "../../../../../../lib/missions-serveur";
import {
  cheminContradictions,
  droitsPreuves,
  hrefAssertion,
  hrefContradictions,
  type ContradictionVue,
} from "../../../../../../lib/preuves";
import { exigerPermission } from "../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Contradictions à arbitrer", "Contradictions to arbitrate") };
}

/**
 * File des contradictions à arbitrer (PRV-04) : assertions dont une preuve contraire n'a pas été
 * tranchée par le consultant. Tant qu'elle reste ouverte, l'indice de solidité est divisé par deux.
 */
export default async function PageContradictions({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await obtenirT();
  const { utilisateur } = await exigerPermission("preuve.lire");
  const r = await chargerMission(id);
  if (!r.ok) return null;
  const droits = droitsPreuves(utilisateur.roles, r.donnees);
  const [ouvertes, closes] = await Promise.all([
    chargerServeur<{ elements: ContradictionVue[] }>(cheminContradictions(id)),
    chargerServeur<{ elements: ContradictionVue[] }>(cheminContradictions(id, true)),
  ]);

  return (
    <>
      <p className="mp-texte-doux">
        {t(
          "Une contradiction est une preuve qui va contre une assertion. Le consultant la tranche : il écarte la preuve contraire ou assume la contradiction, et motive sa décision.",
          "A contradiction is evidence that goes against an assertion. The consultant settles it: they set aside the opposing evidence or accept the contradiction, and justify the decision.",
        )}
      </p>
      {!ouvertes.ok ? (
        <EtatErreur
          titre={t(
            "La file des contradictions n'a pas pu être chargée.",
            "The contradiction queue could not be loaded.",
          )}
          message={ouvertes.message}
          hrefReessayer={hrefContradictions(id)}
        />
      ) : ouvertes.donnees.elements.length === 0 ? (
        <EtatVide
          titre={t("Aucune contradiction à arbitrer.", "No contradiction to arbitrate.")}
          icone="succes"
        >
          <p>
            {t(
              "Toutes les preuves contraires de la mission ont été arbitrées, ou il n'y en a pas.",
              "All opposing evidence on the engagement has been arbitrated, or there is none.",
            )}
          </p>
        </EtatVide>
      ) : (
        <ul
          className="mp-preuves-liste"
          aria-label={t("Contradictions à arbitrer", "Contradictions to arbitrate")}
        >
          {ouvertes.donnees.elements.map((c) => (
            <li key={c.assertion.id} className="mp-contradiction">
              <h3 className="mp-preuve-ligne__titre">
                <Link href={hrefAssertion(id, c.assertion.id)}>{c.assertion.enonce}</Link>
              </h3>
              <span className="mp-preuve-ligne__meta">
                <BadgeSolidite solidite={c.solidite} />
                <BadgeStatut tonalite="danger">
                  {t(`${c.a_arbitrer.length} à arbitrer`, `${c.a_arbitrer.length} to arbitrate`)}
                </BadgeStatut>
              </span>
              <div className="mp-contradiction__duel">
                <section aria-label={t("Preuves en faveur", "Supporting evidence")}>
                  <h4 className="mp-preuve-ligne__titre">
                    {t(`En faveur (${c.preuves_pour.length})`, `For (${c.preuves_pour.length})`)}
                  </h4>
                  <ul className="mp-preuves-liste">
                    {c.preuves_pour.map((p) => (
                      <PreuveLieeCarte
                        key={p.id}
                        missionId={id}
                        assertionId={c.assertion.id}
                        preuve={p}
                        ecrire={false}
                        retrait={false}
                      />
                    ))}
                  </ul>
                </section>
                <section aria-label={t("Preuves contraires", "Opposing evidence")}>
                  <h4 className="mp-preuve-ligne__titre">
                    {t(
                      `Contre (${c.preuves_contre.length})`,
                      `Against (${c.preuves_contre.length})`,
                    )}
                  </h4>
                  <ul className="mp-preuves-liste">
                    {c.preuves_contre.map((p) => (
                      <PreuveLieeCarte
                        key={p.id}
                        missionId={id}
                        assertionId={c.assertion.id}
                        preuve={p}
                        ecrire={droits.ecrire}
                        retrait={false}
                      />
                    ))}
                  </ul>
                </section>
              </div>
            </li>
          ))}
        </ul>
      )}

      {closes.ok && closes.donnees.elements.length > 0 ? (
        <Carte
          titre={t(
            `Contradictions arbitrées (${closes.donnees.elements.length})`,
            `Arbitrated contradictions (${closes.donnees.elements.length})`,
          )}
        >
          <ul className="mp-liste-simple">
            {closes.donnees.elements.map((c) => (
              <li key={c.assertion.id}>
                <Link href={hrefAssertion(id, c.assertion.id)}>{c.assertion.enonce}</Link>
              </li>
            ))}
          </ul>
        </Carte>
      ) : null}
    </>
  );
}
