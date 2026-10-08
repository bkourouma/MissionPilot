import Link from "next/link";
import type { Metadata } from "next";
import { SECTIONS_RETOUR } from "@missionpilot/shared";
import {
  ActionsRetour,
  FormulaireVersionRetour,
} from "../../../../../components/connaissances/FormulairesConnaissances";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import {
  droitsConnaissances,
  libelleOrigine,
  libelleSection,
  libelleStatutContenu,
  tonaliteStatutRetour,
  type RetourDetail,
  type VersionRetour,
} from "../../../../../lib/capitalisation";
import { formaterDate } from "../../../../../lib/format";
import { exigerPermission } from "../../../../../lib/session";

export const metadata: Metadata = { title: "Retour d'expérience" };

/**
 * Un retour d'expérience (CAP-01) : version courante (brouillon automatique, brouillon IA ou
 * rédaction), historique, et pour le chef ou le directeur de la mission : nouvelle version,
 * rédaction proposée par l'IA, validation. L'API vérifie le rôle sur la mission.
 */
export default async function PageRetour({ params }: { params: Promise<{ id: string }> }) {
  const { utilisateur } = await exigerPermission("connaissance.lire");
  const { id } = await params;
  const r = await chargerServeur<RetourDetail>(
    `/api/capitalisation/retours/${encodeURIComponent(id)}`,
  );
  if (!r.ok) {
    return (
      <div className="mp-page mp-connaissances">
        <EtatErreur
          titre="Ce retour d'expérience n'a pas pu être chargé."
          message={r.message}
          hrefReessayer={`/connaissances/retours/${id}`}
        />
      </div>
    );
  }
  const d = r.donnees;
  const droits = droitsConnaissances(utilisateur.roles);
  const affichee = d.version_validee_contenu ?? d.version_courante;
  const redigeable = d.statut === "brouillon" && droits.rediger;
  return (
    <div className="mp-page mp-connaissances">
      <EnteteDePage
        titre={`Retour d'expérience : ${d.mission.intitule}`}
        soustitre={`${d.mission.client} · ouvert le ${formaterDate(d.ouvert_le)}`}
        retour={{ href: "/connaissances/retours", libelle: "Retours d'expérience" }}
        badges={
          <BadgeStatut tonalite={tonaliteStatutRetour(d.statut)}>
            {d.statut === "valide" ? `Validé (version ${d.version_validee})` : "Brouillon"}
          </BadgeStatut>
        }
        actions={
          <Link href={`/connaissances/missions/${d.mission_id}/briques`}>Briques des tâches</Link>
        }
      />
      {affichee ? <Version v={affichee} /> : null}
      {redigeable && d.version_courante ? (
        <>
          <Carte titre="Valider ou améliorer">
            <ActionsRetour
              id={d.id}
              version={d.version_courante.version}
              chiffresNonVerifies={d.version_courante.chiffres_non_verifies}
              ia={droits.ia}
            />
          </Carte>
          <Carte titre="Rédiger une nouvelle version">
            <FormulaireVersionRetour
              id={d.id}
              initiale={{
                contexte: d.version_courante.contexte,
                methode: d.version_courante.methode,
                ecarts: d.version_courante.ecarts,
                lecons: d.version_courante.lecons,
              }}
            />
          </Carte>
        </>
      ) : null}
      <Carte titre="Historique des versions">
        <ul className="mp-liste-lignes">
          {d.historique.map((h) => (
            <li key={h.version} className="mp-liste-lignes__ligne">
              <span>
                {`Version ${h.version} · ${libelleOrigine(h.origine)}`}
                <span className="mp-texte-doux mp-texte-petit">
                  {` · ${h.cree_par_nom ?? "—"} · ${formaterDate(h.cree_le)}`}
                </span>
              </span>
              <BadgeStatut tonalite={h.statut_contenu === "valide" ? "succes" : "neutre"}>
                {libelleStatutContenu(h.statut_contenu)}
              </BadgeStatut>
            </li>
          ))}
        </ul>
      </Carte>
    </div>
  );
}

function Version({ v }: { v: VersionRetour }) {
  return (
    <Carte
      titre={`Version ${v.version} · ${libelleOrigine(v.origine)}`}
      actions={
        <BadgeStatut tonalite="neutre">{libelleStatutContenu(v.statut_contenu)}</BadgeStatut>
      }
    >
      {v.chiffres_non_verifies ? (
        <Alerte tonalite="attention" titre="Nombres à vérifier">
          <p>
            Des nombres de cette rédaction ne viennent pas des moteurs de calcul : relisez-les avant
            de valider.
          </p>
        </Alerte>
      ) : null}
      <dl className="mp-liste-def">
        {SECTIONS_RETOUR.map((k) => (
          <div key={k}>
            <dt>{libelleSection(k)}</dt>
            <dd className="mp-connaissances__section">{v[k]}</dd>
          </div>
        ))}
      </dl>
    </Carte>
  );
}
