import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FormulaireLier } from "../../../../../../../components/preuves/ActionsLiens";
import { FormulaireAssertion } from "../../../../../../../components/preuves/FormulaireAssertion";
import {
  BadgeSolidite,
  ExplicationSolidite,
} from "../../../../../../../components/preuves/BadgeSolidite";
import { PreuveLieeCarte } from "../../../../../../../components/preuves/PreuveLieeCarte";
import { BadgeStatut } from "../../../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../../../components/ui/Carte";
import { EtatErreur } from "../../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../../lib/api-serveur";
import { formaterDateHeure } from "../../../../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../../../../lib/i18n/serveur";
import { estIdentifiant } from "../../../../../../../lib/identifiant";
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import {
  cheminAssertion,
  cheminDimensions,
  droitsPreuves,
  peutSignerAvisExpert,
  hrefAssertion,
  hrefAssertions,
  libelleAuteur,
  libelleClasseRisque,
  libelleRattachement,
  libelleStatutAssertion,
  type DetailAssertion,
  type DimensionVue,
  type PageApi,
  type PreuveVue,
} from "../../../../../../../lib/preuves";
import { exigerPermission } from "../../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Assertion", "Assertion") };
}

/**
 * Détail d'une assertion : indice de solidité calculé par le moteur et son explication, preuves
 * pour et contre, contradictions à arbitrer, liaison de preuves, correction et historique.
 */
export default async function PageDetailAssertion({
  params,
}: {
  params: Promise<{ id: string; assertionId: string }>;
}) {
  const { id, assertionId } = await params;
  const t = await obtenirT();
  const langue = await obtenirLangue();
  if (!estIdentifiant(assertionId)) notFound();
  const { utilisateur } = await exigerPermission("preuve.lire");
  const r = await chargerMission(id);
  if (!r.ok) return null;
  const droits = droitsPreuves(utilisateur.roles, r.donnees);
  const [detail, dimensions, registre] = await Promise.all([
    chargerServeur<DetailAssertion>(cheminAssertion(assertionId)),
    chargerServeur<{ elements: DimensionVue[] }>(cheminDimensions(id)),
    droits.ecrire
      ? chargerServeur<PageApi<PreuveVue>>(`/api/missions/${id}/preuves?limite=100`)
      : Promise.resolve(null),
  ]);
  if (!detail.ok && detail.statut === 404) notFound();
  if (!detail.ok) {
    return (
      <EtatErreur
        titre={t("L'assertion n'a pas pu être chargée.", "The assertion could not be loaded.")}
        message={detail.message}
        hrefReessayer={hrefAssertion(id, assertionId)}
      />
    );
  }
  const a = detail.donnees;
  if (a.mission_id !== id) notFound();
  const dims = dimensions.ok ? dimensions.donnees.elements : [];
  const liees = new Set([...a.preuves_pour, ...a.preuves_contre].map((p) => p.id));
  const candidates = registre?.ok ? registre.donnees.elements.filter((p) => !liees.has(p.id)) : [];

  return (
    <>
      <Link href={hrefAssertions(id)} className="mp-lien-retour">
        {t("Revenir aux assertions", "Back to the assertions")}
      </Link>
      <Carte
        titre={a.enonce}
        actions={
          <BadgeStatut tonalite="neutre" sansIcone>
            {`Version ${a.version}`}
          </BadgeStatut>
        }
      >
        <div className="mp-pile">
          <span className="mp-preuve-ligne__meta">
            <BadgeSolidite solidite={a.solidite} />
            <BadgeStatut tonalite="neutre" sansIcone>
              {libelleClasseRisque(a.classe_risque, langue)}
            </BadgeStatut>
            <BadgeStatut tonalite="neutre" sansIcone>
              {libelleStatutAssertion(a.statut, langue)}
            </BadgeStatut>
          </span>
          <ExplicationSolidite solidite={a.solidite} />
          <p className="mp-texte-doux mp-texte-petit">
            {a.rattachement
              ? `${libelleRattachement(a.rattachement.type, langue)} : ${a.rattachement.code} · `
              : ""}
            {a.livrable ? `${t("Livrable", "Deliverable")} : ${a.livrable} · ` : ""}
            {t(
              `formulée par ${libelleAuteur(a.auteur)}`,
              `written by ${libelleAuteur(a.auteur, "en")}`,
            )}
          </p>
          {a.avis_expert ? (
            <div className="mp-pile">
              <BadgeStatut tonalite={a.avis_expert.signe ? "succes" : "attention"}>
                {a.avis_expert.signe
                  ? t("Avis d'expert signé", "Signed expert opinion")
                  : t("Avis d'expert non signé", "Unsigned expert opinion")}
              </BadgeStatut>
              <p className="mp-texte-petit">{a.avis_expert.motif}</p>
              {a.avis_expert.signe && a.avis_expert.signe_par ? (
                <p className="mp-texte-doux mp-texte-petit">
                  {t(
                    `Signé par ${libelleAuteur(a.avis_expert.signe_par)} le ${formaterDateHeure(a.avis_expert.signe_le)}`,
                    `Signed by ${libelleAuteur(a.avis_expert.signe_par, "en")} on ${formaterDateHeure(a.avis_expert.signe_le, undefined, "en")}`,
                  )}
                </p>
              ) : (
                <p className="mp-texte-doux mp-texte-petit">
                  {t(
                    "Sans signature, cet avis ne tient pas lieu de preuve pour un livrable R2 ou R3.",
                    "Without a signature, this opinion does not count as evidence for an R2 or R3 deliverable.",
                  )}
                </p>
              )}
            </div>
          ) : null}
        </div>
      </Carte>

      <Carte
        titre={t(
          `Preuves en faveur (${a.preuves_pour.length})`,
          `Supporting evidence (${a.preuves_pour.length})`,
        )}
      >
        {a.preuves_pour.length === 0 ? (
          <p className="mp-texte-doux">
            {t(
              "Aucune preuve ne va dans le sens de cette assertion.",
              "No evidence supports this assertion.",
            )}
          </p>
        ) : (
          <ul className="mp-preuves-liste">
            {a.preuves_pour.map((p) => (
              <PreuveLieeCarte
                key={p.id}
                missionId={id}
                assertionId={a.id}
                preuve={p}
                ecrire={droits.ecrire}
              />
            ))}
          </ul>
        )}
      </Carte>

      <Carte
        titre={t(
          `Preuves contraires (${a.preuves_contre.length})`,
          `Opposing evidence (${a.preuves_contre.length})`,
        )}
      >
        {a.preuves_contre.length === 0 ? (
          <p className="mp-texte-doux">
            {t(
              "Aucune preuve ne contredit cette assertion.",
              "No evidence contradicts this assertion.",
            )}
          </p>
        ) : (
          <ul className="mp-preuves-liste">
            {a.preuves_contre.map((p) => (
              <PreuveLieeCarte
                key={p.id}
                missionId={id}
                assertionId={a.id}
                preuve={p}
                ecrire={droits.ecrire}
              />
            ))}
          </ul>
        )}
      </Carte>

      {droits.ecrire ? (
        <>
          <Carte titre={t("Lier une preuve", "Link evidence")}>
            {registre && !registre.ok ? (
              <p className="mp-texte-doux">{registre.message}</p>
            ) : (
              <FormulaireLier assertionId={a.id} candidates={candidates} />
            )}
          </Carte>
          <Carte titre={t("Corriger l'assertion", "Correct the assertion")}>
            <FormulaireAssertion
              missionId={id}
              dimensions={dims}
              assertion={a}
              peutSigner={peutSignerAvisExpert(utilisateur.roles)}
            />
          </Carte>
        </>
      ) : null}

      <Carte titre={t("Historique des versions", "Version history")}>
        <ol className="mp-liste-simple" reversed>
          {a.historique.map((v) => (
            <li key={v.version}>
              <strong>{`Version ${v.version}`}</strong>
              {` · ${formaterDateHeure(v.cree_le, undefined, langue)} · ${libelleAuteur(v.auteur, langue)} · ${v.classe_risque} · ${libelleStatutAssertion(v.statut, langue)}`}
              {v.signe_par
                ? t(" · avis signé", " · opinion signed")
                : v.avis_expert
                  ? t(" · avis non signé", " · opinion unsigned")
                  : ""}
              {v.motif ? ` · ${v.motif}` : t(" · formulation initiale", " · initial wording")}
            </li>
          ))}
        </ol>
      </Carte>
    </>
  );
}
