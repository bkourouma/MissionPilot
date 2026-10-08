import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CLASSE_RISQUE_LIBELLES } from "@missionpilot/shared";
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
import { estIdentifiant } from "../../../../../../../lib/identifiant";
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import {
  cheminAssertion,
  cheminDimensions,
  droitsPreuves,
  hrefAssertion,
  hrefAssertions,
  libelleAuteur,
  RATTACHEMENTS,
  STATUTS_ASSERTION,
  type DetailAssertion,
  type DimensionVue,
  type PageApi,
  type PreuveVue,
} from "../../../../../../../lib/preuves";
import { exigerPermission } from "../../../../../../../lib/session";

export const metadata: Metadata = { title: "Assertion" };

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
        titre="L'assertion n'a pas pu être chargée."
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
        Revenir aux assertions
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
              {`${a.classe_risque} · ${CLASSE_RISQUE_LIBELLES[a.classe_risque]}`}
            </BadgeStatut>
            <BadgeStatut tonalite="neutre" sansIcone>
              {STATUTS_ASSERTION[a.statut]}
            </BadgeStatut>
          </span>
          <ExplicationSolidite solidite={a.solidite} />
          <p className="mp-texte-doux mp-texte-petit">
            {a.rattachement
              ? `${RATTACHEMENTS[a.rattachement.type]} : ${a.rattachement.code} · `
              : ""}
            {a.livrable ? `Livrable : ${a.livrable} · ` : ""}
            {`formulée par ${libelleAuteur(a.auteur)}`}
          </p>
          {a.avis_expert ? (
            <div className="mp-pile">
              <BadgeStatut tonalite={a.avis_expert.signe ? "succes" : "attention"}>
                {a.avis_expert.signe ? "Avis d'expert signé" : "Avis d'expert non signé"}
              </BadgeStatut>
              <p className="mp-texte-petit">{a.avis_expert.motif}</p>
              {a.avis_expert.signe && a.avis_expert.signe_par ? (
                <p className="mp-texte-doux mp-texte-petit">
                  {`Signé par ${libelleAuteur(a.avis_expert.signe_par)} le ${formaterDateHeure(a.avis_expert.signe_le)}`}
                </p>
              ) : (
                <p className="mp-texte-doux mp-texte-petit">
                  Sans signature, cet avis ne tient pas lieu de preuve pour un livrable R2 ou R3.
                </p>
              )}
            </div>
          ) : null}
        </div>
      </Carte>

      <Carte titre={`Preuves en faveur (${a.preuves_pour.length})`}>
        {a.preuves_pour.length === 0 ? (
          <p className="mp-texte-doux">Aucune preuve ne va dans le sens de cette assertion.</p>
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

      <Carte titre={`Preuves contraires (${a.preuves_contre.length})`}>
        {a.preuves_contre.length === 0 ? (
          <p className="mp-texte-doux">Aucune preuve ne contredit cette assertion.</p>
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
          <Carte titre="Lier une preuve">
            {registre && !registre.ok ? (
              <p className="mp-texte-doux">{registre.message}</p>
            ) : (
              <FormulaireLier assertionId={a.id} candidates={candidates} />
            )}
          </Carte>
          <Carte titre="Corriger l'assertion">
            <FormulaireAssertion missionId={id} dimensions={dims} assertion={a} />
          </Carte>
        </>
      ) : null}

      <Carte titre="Historique des versions">
        <ol className="mp-liste-simple" reversed>
          {a.historique.map((v) => (
            <li key={v.version}>
              <strong>{`Version ${v.version}`}</strong>
              {` · ${formaterDateHeure(v.cree_le)} · ${libelleAuteur(v.auteur)} · ${v.classe_risque} · ${STATUTS_ASSERTION[v.statut]}`}
              {v.signe_par ? " · avis signé" : v.avis_expert ? " · avis non signé" : ""}
              {v.motif ? ` · ${v.motif}` : " · formulation initiale"}
            </li>
          ))}
        </ol>
      </Carte>
    </>
  );
}
