import { notFound } from "next/navigation";
import type { Metadata } from "next";
import "../../../../../../components/qualite/froide.css";
import "../../../../../../components/qualite/qualite.css";
import { FroideConstats } from "../../../../../../components/qualite/FroideConstats";
import { FroideDossier } from "../../../../../../components/qualite/FroideDossier";
import { FroideGrille } from "../../../../../../components/qualite/FroideGrille";
import { FroideResultat } from "../../../../../../components/qualite/FroideResultat";
import { FroideTerminer } from "../../../../../../components/qualite/FroideTerminer";
import { BadgeStatut } from "../../../../../../components/ui/BadgeStatut";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { Carte } from "../../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import { formaterDate } from "../../../../../../lib/format";
import {
  cheminDossier,
  cheminEchantillon,
  droitsQualiteFroide,
  estUuid,
  HREF_REVUE_FROIDE,
  hrefCampagne,
  hrefEchantillon,
  libelleStatutEchantillon,
  tonaliteStatutEchantillon,
  type DossierRevue,
  type VueEchantillon,
} from "../../../../../../lib/qualite-froide";
import { exigerAccesFroide } from "../../../../../../lib/qualite-froide-serveur";

export const metadata: Metadata = { title: "Revue à froid d'une mission" };

/**
 * Revue d'une mission tirée : dossier en lecture seule, grille de huit critères, constats,
 * résultat du moteur et fin de la revue. Lecture seule si la revue est terminée ou si
 * l'utilisateur n'est pas le relecteur affecté (`peut_ecrire` vient de l'API).
 */
export default async function PageEchantillonFroid({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await exigerAccesFroide();
  const droits = droitsQualiteFroide(session.utilisateur.roles);
  const { id } = await params;
  if (!estUuid(id)) notFound();
  const [r, dossier] = await Promise.all([
    chargerServeur<VueEchantillon>(cheminEchantillon(id)),
    chargerServeur<DossierRevue>(cheminDossier(id)),
  ]);
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage
          titre="Revue à froid"
          retour={{ href: HREF_REVUE_FROIDE, libelle: "Revue à froid" }}
        />
        <EtatErreur
          titre="La revue n'a pas pu être chargée."
          message={r.message}
          hrefReessayer={hrefEchantillon(id)}
        />
      </div>
    );
  }
  const { echantillon: e, grille, resultat } = r.donnees;
  const terminee = e.statut === "terminee";
  const modifiable = r.donnees.peut_ecrire && !terminee;

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={e.mission.mission_intitule}
        soustitre={`Client : ${e.mission.client_nom} · campagne ${e.campagne.intitule} · relecteur : ${e.relecteur?.nom ?? "non affecté"}`}
        retour={
          droits.gerer
            ? { href: hrefCampagne(e.campagne.id), libelle: "Campagne" }
            : { href: HREF_REVUE_FROIDE, libelle: "Revue à froid" }
        }
        badges={
          <BadgeStatut tonalite={tonaliteStatutEchantillon(e.statut)}>
            {libelleStatutEchantillon(e.statut)}
          </BadgeStatut>
        }
      />

      {terminee ? (
        <Alerte tonalite="info" titre="Revue terminée et figée" annonce="aucune">
          <p>
            Terminée le {formaterDate(e.terminee_le)}. Les notes, les constats et la synthèse ne se
            modifient plus.
          </p>
        </Alerte>
      ) : !r.donnees.peut_ecrire ? (
        <Alerte tonalite="info" titre="Lecture seule" annonce="aucune">
          <p>Seul le relecteur indépendant affecté à cette revue peut la remplir.</p>
        </Alerte>
      ) : null}

      <Carte titre="Dossier de la mission">
        {dossier.ok ? (
          <FroideDossier dossier={dossier.donnees} />
        ) : (
          <EtatErreur
            titre="Le dossier de la mission n'a pas pu être chargé."
            message={dossier.message}
            hrefReessayer={hrefEchantillon(id)}
          />
        )}
      </Carte>

      <section aria-labelledby="titre-grille" className="mp-froide__pile">
        <h2 id="titre-grille" className="mp-section__titre">
          Grille de revue (version {grille.version})
        </h2>
        <p className="mp-texte-doux mp-texte-petit">
          Notez chaque critère de 1 (insuffisant) à 5 (exemplaire), ou déclarez-le sans objet en
          justifiant. Chaque critère s&apos;enregistre séparément.
        </p>
        <FroideGrille
          echantillonId={e.id}
          criteres={grille.criteres}
          evaluations={r.donnees.evaluations}
          modifiable={modifiable}
        />
      </section>

      <Carte titre="Constats">
        <FroideConstats
          echantillonId={e.id}
          constats={r.donnees.constats}
          modifiable={modifiable}
        />
      </Carte>

      <Carte titre={terminee ? "Résultat de la revue" : "Résultat provisoire"}>
        <FroideResultat resultat={resultat} definitif={terminee} />
        {terminee && e.synthese ? (
          <div className="mp-froide__pile">
            <h3 className="mp-qualite__sous-titre">Synthèse du relecteur</h3>
            <p>{e.synthese}</p>
          </div>
        ) : null}
      </Carte>

      {modifiable ? (
        <Carte titre="Terminer la revue">
          <FroideTerminer echantillonId={e.id} />
        </Carte>
      ) : null}
    </div>
  );
}
