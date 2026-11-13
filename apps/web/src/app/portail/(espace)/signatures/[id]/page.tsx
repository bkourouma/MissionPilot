import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { DemandeSignaturePortailApi } from "@missionpilot/shared";
import { NonDisponible } from "../../../../../components/portail/NonDisponible";
import { SignaturePortail } from "../../../../../components/signatures/SignaturePortail";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { estIdentifiant, peut } from "../../../../../lib/portail";
import {
  avancementPortail,
  cheminApiSignaturePortail,
  cheminSignaturePortail,
  CHEMIN_SIGNATURES_PORTAIL,
  libelleMonStatut,
  libelleObjetPortail,
  libelleStatutPortail,
  tonaliteStatutPortail,
} from "../../../../../lib/portail-canaux";
import { chargerPortail, obtenirSessionPortail } from "../../../../../lib/portail-serveur";
import { avertissementSignatureSimulee, libelleEcheance } from "../../../../../lib/signatures";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Signature", "Signature") };
}

/**
 * Une demande de signature de l'espace client : lecture du document, « Signer » ou « Refuser ».
 * L'avancement est donné par des compteurs : jamais le nom d'un membre du cabinet.
 */
export default async function DetailSignaturePortail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await obtenirT();
  const langue = await obtenirLangue();
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await obtenirSessionPortail();
  if (!peut(utilisateur.roles, "portail.signature.signer")) {
    return <NonDisponible titre={t("Signature", "Signature")} />;
  }
  const r = await chargerPortail<DemandeSignaturePortailApi>(cheminApiSignaturePortail(id));
  if (!r.ok && r.statut === 404) notFound();
  const retour = { href: CHEMIN_SIGNATURES_PORTAIL, libelle: t("Signatures", "Signatures") };
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre={t("Signature", "Signature")} retour={retour} />
        <EtatErreur
          titre={t("La demande n'a pas pu être chargée.", "The request could not be loaded.")}
          message={r.message}
          hrefReessayer={cheminSignaturePortail(id)}
        />
      </div>
    );
  }
  const d = r.donnees;
  const etat = libelleMonStatut(d, langue);
  return (
    <div className="mp-page mp-page--etroite">
      <EnteteDePage
        titre={libelleObjetPortail(d.objet, langue)}
        retour={retour}
        badges={<BadgeStatut tonalite={etat.tonalite}>{etat.libelle}</BadgeStatut>}
      />
      <Alerte tonalite="attention" annonce="aucune" titre={avertissementSignatureSimulee(langue)}>
        <p>
          {t(
            "Cette signature est un exercice : elle ne remplace ni une signature électronique qualifiée ni une signature manuscrite.",
            "This signature is an exercise: it replaces neither a qualified electronic signature nor a handwritten signature.",
          )}
        </p>
      </Alerte>
      <Carte titre={t("Demande", "Request")} niveauTitre={2}>
        <dl className="mp-liste-def">
          <div>
            <dt>{t("Statut de la demande", "Request status")}</dt>
            <dd>
              <BadgeStatut tonalite={tonaliteStatutPortail(d.statut)}>
                {libelleStatutPortail(d.statut, langue)}
              </BadgeStatut>
            </dd>
          </div>
          <div>
            <dt>{t("Avancement", "Progress")}</dt>
            <dd>{avancementPortail(d, langue)}</dd>
          </div>
          <div>
            <dt>{t("Échéance", "Due date")}</dt>
            <dd>{libelleEcheance(d.expire_le, langue)}</dd>
          </div>
        </dl>
        <SignaturePortail
          signatureId={d.id}
          peutSigner={d.peut_signer}
          peutLire={d.mon_statut !== "en_attente"}
        />
      </Carte>
    </div>
  );
}
